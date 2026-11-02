import { differenceInCalendarDays, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { getFreeWindows } from "./freeWindows";
import { DEFAULT_WEIGHTS, type ScoreWeights, overlapRatio, scoreProposal } from "./score";
import { type TravelTimeProvider, isSamePlace } from "./travel";
import {
  TIME_ZONE,
  addMinutesTo,
  assertDay,
  eachDay,
  minutesBetween,
  zonedDayBounds,
} from "./time";
import type {
  Availability,
  DayHours,
  FreeWindow,
  MeetupProposal,
  MeetupRequest,
  Person,
  PersonId,
  Place,
  PlaceId,
  TravelLeg,
} from "./types";

/** Heures de la journée considérées par défaut pour se voir. */
export const DEFAULT_DAY_HOURS: DayHours = { start: "08:00", end: "22:00" };

/**
 * Nombre maximal de jours d'une recherche. Le coût est proportionnel à
 * jours × lieux × personnes : sans limite, une requête sur des années (venue d'un
 * formulaire ou d'une API) bloquerait le serveur. Un an suffit largement.
 */
export const MAX_SEARCH_DAYS = 366;

/** Intervalle où une personne peut être au lieu P, avec ses trajets pour y aller et repartir. */
export interface PlaceAvailability extends Availability {
  /** Trajets (sans marge) vers P et de P vers le lieu suivant. */
  leg: TravelLeg;
}

/** Intervalle commun à plusieurs personnes, avec les trajets de chacune. */
interface SharedInterval {
  start: Date;
  end: Date;
  legs: Record<PersonId, TravelLeg>;
}

/**
 * Disponibilité réelle d'une personne à un lieu P pendant une fenêtre libre (section 3) :
 * - arrivée au plus tôt = fin du bloc précédent + trajet(lieuAvant → P) + marge ;
 * - départ au plus tard = début du bloc suivant − trajet(P → lieuAprès) − marge ;
 * - disponible seulement si arrivée < départ.
 *
 * La marge s'ajoute à chaque trajet réel : si la personne est déjà au lieu P (trajet de
 * 0 min), il n'y a pas de trajet, donc pas de marge.
 */
export function availabilityInWindow(
  window: FreeWindow,
  leg: TravelLeg,
  bufferMinutes: number,
): { start: Date; end: Date } | null {
  const toTotal = leg.to > 0 ? leg.to + bufferMinutes : 0;
  const fromTotal = leg.from > 0 ? leg.from + bufferMinutes : 0;
  const start = addMinutesTo(window.start, toTotal);
  const end = addMinutesTo(window.end, -fromTotal);
  return start.getTime() < end.getTime() ? { start, end } : null;
}

/**
 * Intersection de deux listes d'intervalles triés et disjoints (balayage à deux curseurs).
 */
export function intersectIntervals(a: SharedInterval[], b: SharedInterval[]): SharedInterval[] {
  const out: SharedInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start.getTime(), b[j].start.getTime());
    const end = Math.min(a[i].end.getTime(), b[j].end.getTime());
    if (start < end) {
      out.push({
        start: new Date(start),
        end: new Date(end),
        legs: { ...a[i].legs, ...b[j].legs },
      });
    }
    if (a[i].end.getTime() < b[j].end.getTime()) i++;
    else j++;
  }
  return out;
}

/** Lieux candidats : ceux de la requête, sinon tous les lieux des participants + favoris. */
export function candidatePlaces(
  participants: readonly Person[],
  request: MeetupRequest,
  placeById: ReadonlyMap<PlaceId, Place>,
): Place[] {
  if (request.candidatePlaceIds && request.candidatePlaceIds.length > 0) {
    return [...new Set(request.candidatePlaceIds)].map((id) => {
      const place = placeById.get(id);
      if (!place) throw new Error(`Lieu candidat inconnu : ${id}`);
      return place;
    });
  }
  const seen = new Map<PlaceId, Place>();
  for (const person of participants) for (const p of person.places) seen.set(p.id, p);
  for (const p of request.favoritePlaces ?? []) seen.set(p.id, p);
  return [...seen.values()];
}

/** Index de tous les lieux connus (lieux des participants + favoris du groupe). */
function indexPlaces(participants: readonly Person[], request: MeetupRequest): Map<PlaceId, Place> {
  const index = new Map<PlaceId, Place>();
  for (const person of participants) for (const p of person.places) index.set(p.id, p);
  for (const p of request.favoritePlaces ?? []) index.set(p.id, p);
  return index;
}

/** Valide la requête et renvoie les participants dans l'ordre de `personIds`. */
function resolveParticipants(people: readonly Person[], request: MeetupRequest): Person[] {
  // Number.isFinite : NaN passait les comparaisons (« NaN <= 0 » est faux) et une durée
  // minimale NaN acceptait alors n'importe quel créneau, même de 1 minute.
  if (!Number.isFinite(request.minDurationMinutes) || request.minDurationMinutes <= 0) {
    throw new Error("La durée minimale doit être un nombre positif.");
  }
  if (!Number.isFinite(request.bufferMinutes) || request.bufferMinutes < 0) {
    throw new Error("La marge doit être un nombre positif ou nul.");
  }
  assertDay(request.dates.from);
  assertDay(request.dates.to);
  const days =
    differenceInCalendarDays(parseISO(request.dates.to), parseISO(request.dates.from)) + 1;
  if (days > MAX_SEARCH_DAYS) {
    throw new Error(`La période de recherche dépasse ${MAX_SEARCH_DAYS} jours.`);
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  return [...new Set(request.personIds)].map((id) => {
    const person = byId.get(id);
    if (!person) throw new Error(`Personne inconnue : ${id}`);
    return person;
  });
}

/**
 * Recherche des rencontres réalistes en personne (section 3 du plan, étapes 1 à 4).
 *
 * Pour chaque jour de la requête et chaque lieu candidat P : pour chaque personne et chaque
 * fenêtre libre, disponibilité à P = [fin + trajet(lieuAvant → P) + marge,
 * début suivant − trajet(P → lieuAprès) − marge] ; intersection entre toutes les personnes ;
 * on garde les intervalles d'au moins `minDurationMinutes`.
 *
 * Fonction pure : le fournisseur de trajets est injecté. Toutes les propositions sont
 * renvoyées, dans l'ordre chronologique, avec `score = 0`. `findMeetups` les classe.
 */
export async function findMeetupCandidates(
  people: readonly Person[],
  request: MeetupRequest,
  travelProvider: TravelTimeProvider,
): Promise<MeetupProposal[]> {
  const participants = resolveParticipants(people, request);
  if (participants.length === 0) return [];

  const placeById = indexPlaces(participants, request);
  const candidates = candidatePlaces(participants, request, placeById);
  const dayHours = request.dayHours ?? DEFAULT_DAY_HOURS;

  // Cache local des trajets pour cet appel (en plus d'un éventuel cache du provider).
  const travel = memoizeTravel(travelProvider);

  const proposals: MeetupProposal[] = [];

  for (const day of eachDay(request.dates.from, request.dates.to)) {
    const { start: dayStart, end: dayEnd } = zonedDayBounds(day);
    const windowsByPerson = participants.map((person) =>
      getFreeWindows(person, dayStart, dayEnd, { dayHours }),
    );
    // Si quelqu'un n'a aucune fenêtre ce jour-là, inutile d'essayer les lieux.
    if (windowsByPerson.some((w) => w.length === 0)) continue;

    for (const place of candidates) {
      let shared: SharedInterval[] | null = null;

      for (let k = 0; k < participants.length; k++) {
        const own: SharedInterval[] = (
          await availabilitiesAtPlace(
            participants[k],
            windowsByPerson[k],
            place,
            placeById,
            request.bufferMinutes,
            travel,
          )
        ).map((a) => ({ start: a.start, end: a.end, legs: { [a.personId]: a.leg } }));
        shared = shared === null ? own : intersectIntervals(shared, own);
        if (shared.length === 0) break;
      }

      for (const interval of shared ?? []) {
        if (minutesBetween(interval.start, interval.end) < request.minDurationMinutes) continue;
        proposals.push({
          kind: "in-person",
          placeId: place.id,
          start: interval.start,
          end: interval.end,
          travelByPerson: interval.legs,
          score: 0,
        });
      }
    }
  }

  return proposals.sort(compareChronologically);
}

/**
 * Créneaux d'appel/visio d'un jour : trous communs à tous (sans trajet, donc sans marge)
 * d'au moins `minDurationMinutes`.
 */
export function findCallSlots(
  people: readonly Person[],
  request: MeetupRequest,
  day: string,
): MeetupProposal[] {
  const participants = resolveParticipants(people, request);
  if (participants.length === 0) return [];
  const dayHours = request.dayHours ?? DEFAULT_DAY_HOURS;
  const { start: dayStart, end: dayEnd } = zonedDayBounds(day);

  let shared: SharedInterval[] | null = null;
  for (const person of participants) {
    const own = getFreeWindows(person, dayStart, dayEnd, { dayHours }).map((w) => ({
      start: w.start,
      end: w.end,
      legs: { [person.id]: { to: 0, from: 0 } },
    }));
    shared = shared === null ? own : intersectIntervals(shared, own);
    if (shared.length === 0) return [];
  }
  return (shared ?? [])
    .filter((i) => minutesBetween(i.start, i.end) >= request.minDurationMinutes)
    .map((i) => ({
      kind: "call" as const,
      placeId: null,
      start: i.start,
      end: i.end,
      travelByPerson: i.legs,
      score: 0,
    }));
}

/** Options du classement des propositions. */
export interface FindMeetupsOptions {
  /** Nombre maximal de propositions par jour (défaut 3). */
  maxPerDay?: number;
  /** Poids du score (défaut : DEFAULT_WEIGHTS). */
  weights?: ScoreWeights;
  /**
   * Au-delà de cette part de chevauchement (0 à 1), deux propositions au même lieu sont
   * considérées comme des doublons et seule la meilleure est gardée (défaut 0,8).
   */
  overlapThreshold?: number;
  /** Proposer un appel les jours sans rencontre en personne possible (défaut : oui). */
  includeCalls?: boolean;
}

/** Nombre maximal de propositions par jour, par défaut. */
export const DEFAULT_MAX_PER_DAY = 3;

/** Part de chevauchement au-delà de laquelle deux propositions au même lieu sont des doublons. */
export const DEFAULT_OVERLAP_THRESHOLD = 0.8;

/**
 * Classe des propositions : calcul du score, tri du meilleur au moins bon, retrait des
 * doublons (même lieu, chevauchement > seuil) et limite par jour local. Fonction pure.
 */
export function rankProposals(
  proposals: readonly MeetupProposal[],
  places: ReadonlyMap<PlaceId, Place>,
  options: FindMeetupsOptions & { referenceTime?: Date } = {},
): MeetupProposal[] {
  const {
    maxPerDay = DEFAULT_MAX_PER_DAY,
    weights = DEFAULT_WEIGHTS,
    overlapThreshold = DEFAULT_OVERLAP_THRESHOLD,
    referenceTime,
  } = options;

  const scored = proposals
    .map((p) => ({ ...p, score: scoreProposal(p, weights, { referenceTime }) }))
    .sort((a, b) => b.score - a.score || compareChronologically(a, b));

  const sameLocation = (a: MeetupProposal, b: MeetupProposal): boolean => {
    if (a.placeId === null || b.placeId === null) return a.placeId === b.placeId;
    if (a.placeId === b.placeId) return true;
    const pa = places.get(a.placeId);
    const pb = places.get(b.placeId);
    return pa !== undefined && pb !== undefined && isSamePlace(pa, pb);
  };

  const kept: MeetupProposal[] = [];
  const countByDay = new Map<string, number>();
  for (const p of scored) {
    const day = formatInTimeZone(p.start, TIME_ZONE, "yyyy-MM-dd");
    const count = countByDay.get(day) ?? 0;
    if (count >= maxPerDay) continue;
    if (kept.some((k) => sameLocation(k, p) && overlapRatio(k, p) > overlapThreshold)) continue;
    kept.push(p);
    countByDay.set(day, count + 1);
  }
  return kept;
}

/**
 * Recherche et classement des rencontres (sections 3 et segment 5).
 *
 * 1. Propositions en personne réalistes (`findMeetupCandidates`).
 * 2. Pour chaque jour sans rencontre en personne possible : proposition « appel » sur les
 *    trous communs (trajet = 0).
 * 3. Score (`scoreProposal`), tri du meilleur au moins bon, retrait des propositions au même
 *    lieu qui se chevauchent à plus de 80 %, au plus `maxPerDay` par jour.
 */
export async function findMeetups(
  people: readonly Person[],
  request: MeetupRequest,
  travelProvider: TravelTimeProvider,
  options: FindMeetupsOptions = {},
): Promise<MeetupProposal[]> {
  const participants = resolveParticipants(people, request);
  if (participants.length === 0) return [];

  const inPerson = await findMeetupCandidates(participants, request, travelProvider);

  const calls: MeetupProposal[] = [];
  if (options.includeCalls ?? true) {
    const daysWithMeetup = new Set(
      inPerson.map((p) => formatInTimeZone(p.start, TIME_ZONE, "yyyy-MM-dd")),
    );
    for (const day of eachDay(request.dates.from, request.dates.to)) {
      if (!daysWithMeetup.has(day)) calls.push(...findCallSlots(participants, request, day));
    }
  }

  return rankProposals([...inPerson, ...calls], indexPlaces(participants, request), {
    ...options,
    referenceTime: zonedDayBounds(request.dates.from).start,
  });
}

function compareChronologically(a: MeetupProposal, b: MeetupProposal): number {
  return a.start.getTime() - b.start.getTime() || (a.placeId ?? "").localeCompare(b.placeId ?? "");
}

/** Enveloppe un fournisseur de trajets avec un cache local (une requête par paire et mode). */
export function memoizeTravel(provider: TravelTimeProvider): TravelTimeProvider {
  const cache = new Map<string, Promise<number>>();
  return {
    minutes(from, to, mode) {
      const key = `${from.id}|${to.id}|${mode}`;
      let value = cache.get(key);
      if (!value) {
        value = provider.minutes(from, to, mode);
        cache.set(key, value);
      }
      return value;
    },
  };
}

/**
 * Disponibilités réelles d'une personne à un lieu P pour une liste de fenêtres libres
 * (étape 2 de l'algorithme). `places` doit contenir les lieux avant/après des fenêtres.
 */
export async function availabilitiesAtPlace(
  person: Person,
  windows: readonly FreeWindow[],
  place: Place,
  places: ReadonlyMap<PlaceId, Place>,
  bufferMinutes: number,
  travelProvider: TravelTimeProvider,
): Promise<PlaceAvailability[]> {
  const out: PlaceAvailability[] = [];
  for (const window of windows) {
    const before = places.get(window.placeBeforeId);
    const after = places.get(window.placeAfterId);
    if (!before) throw new Error(`Lieu inconnu : ${window.placeBeforeId}`);
    if (!after) throw new Error(`Lieu inconnu : ${window.placeAfterId}`);
    const leg: TravelLeg = {
      to: await travelProvider.minutes(before, place, person.travelMode),
      from: await travelProvider.minutes(place, after, person.travelMode),
    };
    const slot = availabilityInWindow(window, leg, bufferMinutes);
    if (slot) out.push({ personId: person.id, ...slot, leg });
  }
  return out;
}
