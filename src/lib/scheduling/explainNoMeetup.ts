/**
 * « Pourquoi pas ? » (story 4) : quand aucune rencontre en personne n'est possible, trouver les
 * « presque » (créneaux communs trop courts), nommer la personne qui coupe le moment et la
 * raison (trajet ou horaire), puis proposer le plus petit compromis qui débloque.
 *
 * Fonction pure : même calcul que `findMeetupCandidates` (fenêtres libres, disponibilité réelle
 * à chaque lieu, intersection), avec le fournisseur de trajets injecté. Elle ne demande que les
 * paires de lieux que la recherche a déjà demandées : aucun appel d'API de plus.
 *
 * Confidentialité : le résultat ne contient ni titre de bloc ni lieu d'avant/après ; seulement
 * des heures (« occupé·e jusqu'à 13 h »), des durées de trajet et le lieu de rencontre.
 */
import { formatInTimeZone } from "date-fns-tz";

import {
  DEFAULT_DAY_HOURS,
  availabilitiesAtPlace,
  candidatePlaces,
  findCallSlots,
  intersectIntervals,
  memoizeTravel,
  type PlaceAvailability,
} from "./findMeetups";
import { getFreeWindows } from "./freeWindows";
import { TIME_ZONE, addMinutesTo, eachDay, minutesBetween, zonedDayBounds } from "./time";
import type { TravelTimeProvider } from "./travel";
import type { MeetupRequest, Person, PersonId, Place, PlaceId, TravelLeg } from "./types";
import { formatClockFr, parseClock } from "./weeklyBlocks";

/** Un « presque » : créneau commun d'au moins cette part de la durée minimale (défaut 50 %). */
export const DEFAULT_ALMOST_RATIO = 0.5;
/** « Presque » montrés au plus. */
export const DEFAULT_MAX_ALMOST = 3;
/** On ne propose jamais de réduire la durée sous ce seuil (minutes). */
export const MIN_SHORTENED_MINUTES = 15;
/** Une durée réduite est arrondie vers le bas à ce pas (minutes). */
export const SHORTEN_STEP_MINUTES = 5;

/** Ce qui coupe le moment commun d'un côté (arrivée ou départ) pour une personne. */
export interface LimitCause {
  /** « arrival » : arrive trop tard ; « departure » : doit repartir trop tôt. */
  side: "arrival" | "departure";
  /** « travel » : il y a un trajet ; « busy » : déjà sur place, seulement occupé·e. */
  reason: "travel" | "busy";
  /** Arrivée : fin de l'occupation (« occupé·e jusqu'à »). Départ : début (« occupé·e dès »). */
  busyEdge: Date;
  /** Trajet vers le lieu (arrivée) ou vers le lieu suivant (départ), sans marge. */
  travelMinutes: number;
  /** Marge comptée sur ce trajet (0 s'il n'y a pas de trajet). */
  bufferMinutes: number;
  /** Minutes que ce côté enlève au moment commun par rapport aux autres personnes. */
  cutMinutes: number;
}

/** La personne qui coupe le plus le moment commun. */
export interface LimitingPerson {
  personId: PersonId;
  /** Sa propre disponibilité au lieu (trajets et marges comptés). */
  ownStart: Date;
  ownEnd: Date;
  /** Côté(s) qui coupent, l'arrivée d'abord. Vide si elle ne coupe rien de plus que les autres. */
  causes: LimitCause[];
}

/** Un compromis qui rend la rencontre possible. */
export type Compromise =
  /** Réduire la durée minimale (jamais sous 15 min). */
  | { kind: "shorten"; durationMinutes: number }
  /** Se voir ailleurs le même jour, là où ça marche avec tout le monde. */
  | { kind: "other-place"; placeId: PlaceId; start: Date; end: Date }
  /** Se voir sans la personne limitante (au même lieu). */
  | { kind: "without"; personId: PersonId; start: Date; end: Date }
  /** Un appel ou une visio ce jour-là (sans trajet). */
  | { kind: "call"; start: Date; end: Date };

/** Un créneau « presque » possible, avec son explication et ses compromis. */
export interface AlmostMeetup {
  /** Jour local (`yyyy-MM-dd`). */
  day: string;
  placeId: PlaceId;
  start: Date;
  end: Date;
  /** Durée du moment commun (minutes). */
  sharedMinutes: number;
  /** Minutes qui manquent pour la durée minimale. */
  missingMinutes: number;
  travelByPerson: Record<PersonId, TravelLeg>;
  /** `null` quand rien ne distingue une personne (ex. le créneau est coupé par « maintenant »). */
  limiting: LimitingPerson | null;
  /** Compromis possibles, du plus petit au plus grand. */
  compromises: Compromise[];
}

export interface ExplainOptions {
  /** Part minimale de la durée pour un « presque » (défaut 0,5). */
  almostRatio?: number;
  /** « Presque » renvoyés au plus (défaut 3). */
  maxAlmost?: number;
}

interface Shared {
  start: Date;
  end: Date;
  legs: Record<PersonId, TravelLeg>;
}

/**
 * Explique l'absence de rencontre en personne : jusqu'à `maxAlmost` créneaux « presque »
 * (au plus un par jour et par lieu), du plus proche de la durée minimale au plus loin.
 * Liste vide si personne n'a de moment commun assez long (moins de la moitié de la durée).
 */
export async function explainNoMeetup(
  people: readonly Person[],
  request: MeetupRequest,
  travelProvider: TravelTimeProvider,
  options: ExplainOptions = {},
): Promise<AlmostMeetup[]> {
  const almostRatio = options.almostRatio ?? DEFAULT_ALMOST_RATIO;
  const maxAlmost = options.maxAlmost ?? DEFAULT_MAX_ALMOST;
  const min = request.minDurationMinutes;
  if (!Number.isFinite(min) || min <= 0) {
    throw new Error("La durée minimale doit être un nombre positif.");
  }

  const byId = new Map(people.map((p) => [p.id, p]));
  const participants = [...new Set(request.personIds)].map((id) => {
    const person = byId.get(id);
    if (!person) throw new Error(`Personne inconnue : ${id}`);
    return person;
  });
  if (participants.length < 2) return [];

  const placeById = new Map<PlaceId, Place>();
  for (const person of participants) for (const p of person.places) placeById.set(p.id, p);
  for (const p of request.favoritePlaces ?? []) placeById.set(p.id, p);
  const candidates = candidatePlaces(participants, request, placeById);
  const dayHours = request.dayHours ?? DEFAULT_DAY_HOURS;
  const travel = memoizeTravel(travelProvider);
  const notBefore = request.notBefore?.getTime();

  const found: AlmostMeetup[] = [];

  for (const day of eachDay(request.dates.from, request.dates.to)) {
    const { start: dayStart, end: dayEnd } = zonedDayBounds(day);
    if (notBefore !== undefined && dayEnd.getTime() <= notBefore) continue;
    const windowsByPerson = participants.map((person) =>
      getFreeWindows(person, dayStart, dayEnd, { dayHours }),
    );
    if (windowsByPerson.some((w) => w.length === 0)) continue;

    // Disponibilités de chacun à chaque lieu, puis moment commun à tous.
    const byPlace: Array<{ place: Place; own: PlaceAvailability[][]; shared: Shared[] }> = [];
    for (const place of candidates) {
      const own: PlaceAvailability[][] = [];
      for (let k = 0; k < participants.length; k++) {
        own.push(
          await availabilitiesAtPlace(
            participants[k],
            windowsByPerson[k],
            place,
            placeById,
            request.bufferMinutes,
            travel,
          ),
        );
      }
      byPlace.push({ place, own, shared: clip(intersectAll(own), notBefore) });
    }

    let calls: Array<{ start: Date; end: Date }> | null = null;
    const callSlots = (): Array<{ start: Date; end: Date }> => {
      calls ??= findCallSlots(participants, { ...request, dates: { from: day, to: day } }, day);
      return calls;
    };

    for (const { place, own, shared } of byPlace) {
      // Le meilleur « presque » de ce lieu ce jour-là.
      let best: Shared | null = null;
      for (const s of shared) {
        const d = minutesBetween(s.start, s.end);
        if (d >= min || d < min * almostRatio) continue;
        if (!best || d > minutesBetween(best.start, best.end)) best = s;
      }
      if (!best) continue;

      const sharedMinutes = Math.floor(minutesBetween(best.start, best.end));
      const missingMinutes = Math.ceil(min - minutesBetween(best.start, best.end));
      const ownIntervals = participants.map((_, k) => containing(own[k], best));
      const limiting = findLimiting(participants, ownIntervals, best, notBefore, request);

      const compromises: Compromise[] = [];
      const shortened =
        Math.floor(minutesBetween(best.start, best.end) / SHORTEN_STEP_MINUTES) *
        SHORTEN_STEP_MINUTES;
      if (shortened >= MIN_SHORTENED_MINUTES && shortened < min) {
        compromises.push({ kind: "shorten", durationMinutes: shortened });
      }

      const other = closestWorking(
        byPlace.filter((b) => b.place.id !== place.id),
        best,
        min,
      );
      if (other) compromises.push({ kind: "other-place", ...other });

      if (limiting && participants.length > 2) {
        const k = participants.findIndex((p) => p.id === limiting.personId);
        const others = clip(intersectAll(own.filter((_, i) => i !== k)), notBefore).filter(
          (s) => minutesBetween(s.start, s.end) >= min,
        );
        const pick = closestTo(others, best);
        if (pick) {
          compromises.push({
            kind: "without",
            personId: limiting.personId,
            start: pick.start,
            end: pick.end,
          });
        }
      }

      const call = closestTo(
        callSlots().filter((s) => minutesBetween(s.start, s.end) >= min),
        best,
      );
      if (call) compromises.push({ kind: "call", start: call.start, end: call.end });

      found.push({
        day,
        placeId: place.id,
        start: best.start,
        end: best.end,
        sharedMinutes,
        missingMinutes,
        travelByPerson: best.legs,
        limiting,
        compromises,
      });
    }
  }

  return found
    .sort(
      (a, b) =>
        a.missingMinutes - b.missingMinutes ||
        a.start.getTime() - b.start.getTime() ||
        a.placeId.localeCompare(b.placeId),
    )
    .slice(0, maxAlmost);
}

/** Intersection des disponibilités de toutes les personnes (trajets gardés). */
function intersectAll(own: readonly PlaceAvailability[][]): Shared[] {
  let shared: Shared[] | null = null;
  for (const list of own) {
    const mine = list.map((a) => ({ start: a.start, end: a.end, legs: { [a.personId]: a.leg } }));
    shared = shared === null ? mine : intersectIntervals(shared, mine);
    if (shared.length === 0) return [];
  }
  return shared ?? [];
}

/** Retire ce qui est avant `notBefore` (même règle que la recherche). */
function clip(intervals: Shared[], notBefore: number | undefined): Shared[] {
  if (notBefore === undefined) return intervals;
  return intervals
    .filter((i) => i.end.getTime() > notBefore)
    .map((i) => (i.start.getTime() >= notBefore ? i : { ...i, start: new Date(notBefore) }));
}

/** La disponibilité de la liste qui contient le moment commun (il y en a toujours une). */
function containing(list: readonly PlaceAvailability[], s: Shared): PlaceAvailability {
  const hit = list.find(
    (a) => a.start.getTime() <= s.start.getTime() && a.end.getTime() >= s.end.getTime(),
  );
  if (!hit) throw new Error("Disponibilité introuvable pour le moment commun.");
  return hit;
}

/**
 * Personne limitante : celle dont l'arrivée au plus tôt et le départ au plus tard coupent le
 * plus le moment commun, par rapport à la personne suivante (et à « maintenant »).
 */
function findLimiting(
  participants: readonly Person[],
  own: readonly PlaceAvailability[],
  shared: Shared,
  notBefore: number | undefined,
  request: MeetupRequest,
): LimitingPerson | null {
  let best: { k: number; cut: number; causes: LimitCause[] } | null = null;
  for (let k = 0; k < own.length; k++) {
    const othersStart = Math.max(
      notBefore ?? -Infinity,
      ...own.filter((_, j) => j !== k).map((a) => a.start.getTime()),
    );
    const othersEnd = Math.min(...own.filter((_, j) => j !== k).map((a) => a.end.getTime()));
    const arrivalCut = Math.max(0, minutesBetween(new Date(othersStart), own[k].start));
    const departureCut = Math.max(0, minutesBetween(own[k].end, new Date(othersEnd)));
    const causes: LimitCause[] = [];
    const { leg } = own[k];
    if (arrivalCut > 0) {
      const buffer = leg.to > 0 ? request.bufferMinutes : 0;
      causes.push({
        side: "arrival",
        reason: leg.to > 0 ? "travel" : "busy",
        busyEdge: addMinutesTo(own[k].start, -(leg.to + buffer)),
        travelMinutes: leg.to,
        bufferMinutes: buffer,
        cutMinutes: Math.round(arrivalCut),
      });
    }
    if (departureCut > 0) {
      const buffer = leg.from > 0 ? request.bufferMinutes : 0;
      causes.push({
        side: "departure",
        reason: leg.from > 0 ? "travel" : "busy",
        busyEdge: addMinutesTo(own[k].end, leg.from + buffer),
        travelMinutes: leg.from,
        bufferMinutes: buffer,
        cutMinutes: Math.round(departureCut),
      });
    }
    const cut = arrivalCut + departureCut;
    if (cut > 0 && (!best || cut > best.cut)) best = { k, cut, causes };
  }
  if (!best || shared.end.getTime() <= shared.start.getTime()) return null;
  return {
    personId: participants[best.k].id,
    ownStart: own[best.k].start,
    ownEnd: own[best.k].end,
    causes: best.causes,
  };
}

/** Parmi des intervalles, celui qui chevauche `ref` ou, à défaut, le plus proche dans le temps. */
function closestTo<T extends { start: Date; end: Date }>(
  list: readonly T[],
  ref: { start: Date; end: Date },
): T | null {
  let pick: T | null = null;
  let pickGap = Infinity;
  for (const s of list) {
    const gap = Math.max(
      0,
      s.start.getTime() - ref.end.getTime(),
      ref.start.getTime() - s.end.getTime(),
    );
    if (gap < pickGap) {
      pick = s;
      pickGap = gap;
    }
  }
  return pick;
}

/** Un autre lieu où tout le monde a au moins `min` minutes, le plus proche dans le temps. */
function closestWorking(
  places: ReadonlyArray<{ place: Place; shared: Shared[] }>,
  ref: Shared,
  min: number,
): { placeId: PlaceId; start: Date; end: Date } | null {
  const options = places.flatMap(({ place, shared }) =>
    shared
      .filter((s) => minutesBetween(s.start, s.end) >= min)
      .map((s) => ({ placeId: place.id, start: s.start, end: s.end })),
  );
  return closestTo(options, ref);
}

// ---------------------------------------------------------------------------
// Phrase en français (Québec)
// ---------------------------------------------------------------------------

/** « 13 h », « 13 h 05 » dans le fuseau de l'app. */
function clock(instant: Date): string {
  const minutes = parseClock(formatInTimeZone(instant, TIME_ZONE, "HH:mm"));
  return minutes === null ? "" : formatClockFr(minutes);
}

function travelText(cause: LimitCause, verb: string): string {
  const marge = cause.bufferMinutes > 0 ? ` (+ ${cause.bufferMinutes} min de marge)` : "";
  return `il lui faut ${cause.travelMinutes} min${marge} pour ${verb}`;
}

function causeText(cause: LimitCause): string {
  if (cause.side === "arrival") {
    const busy = `occupé·e jusqu'à ${clock(cause.busyEdge)}`;
    return cause.reason === "travel" ? `${busy} et ${travelText(cause, "s'y rendre")}` : busy;
  }
  const busy = `occupé·e dès ${clock(cause.busyEdge)}`;
  return cause.reason === "travel" ? `${busy} et ${travelText(cause, "repartir")}` : busy;
}

/**
 * Phrase qui explique un « presque », sans titre de bloc ni lieu d'avant/après :
 * « Léa n'a que 35 min à Café X une fois le trajet compté : occupé·e jusqu'à 13 h et il lui
 * faut 18 min (+ 5 min de marge) pour s'y rendre. »
 */
export function explainSentence(
  almost: Pick<AlmostMeetup, "sharedMinutes" | "missingMinutes" | "limiting">,
  personName: string | null,
  placeName: string,
): string {
  const { limiting } = almost;
  if (!limiting || limiting.causes.length === 0 || personName === null) {
    return `Le moment commun à ${placeName} ne dure que ${almost.sharedMinutes} min : il manque ${almost.missingMinutes} min.`;
  }
  const own = Math.floor(minutesBetween(limiting.ownStart, limiting.ownEnd));
  const hasTravel = limiting.causes.some((c) => c.reason === "travel");
  const lead =
    own <= almost.sharedMinutes
      ? `${personName} n'a que ${own} min à ${placeName}${hasTravel ? " une fois le trajet compté" : ""}`
      : `C'est ${personName} qui écourte le moment à ${placeName}`;
  return `${lead} : ${limiting.causes.map(causeText).join(" ; ")}.`;
}
