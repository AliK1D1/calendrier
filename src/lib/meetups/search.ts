/**
 * « Quand on peut se voir » (segment 11) : validation de la demande, lecture des données du
 * groupe par un magasin injecté (Supabase dans l'app, PGlite dans les tests), conversion
 * (`toPeople`), appel à `findMeetups` et mise en forme des propositions pour l'interface.
 *
 * Aucun accès BD direct ici : le magasin lit **au nom de la personne connectée** (son jeton,
 * donc la RLS), jamais avec une clé service. L'horaire des autres membres vient uniquement de
 * `group_busy_blocks` (titres masqués, et seulement pour un membre du groupe).
 *
 * Lieux non visibles : un bloc peut pointer vers un lieu que la RLS ne nous laisse pas lire
 * (ex. le lieu favori d'un AUTRE groupe de ce membre, ou un lieu supprimé). Le bloc compte
 * quand même comme occupé (l'heure est toujours respectée), mais on suppose que la personne
 * est **chez elle** pendant ce bloc (même règle que `toPeople` pour un lieu inconnu). Le
 * nombre de blocs concernés est renvoyé pour l'afficher. Ces lieux ne sont jamais proposés.
 */
import { formatInTimeZone } from "date-fns-tz";
import { frCA } from "date-fns/locale";

import {
  type BusyBlockInput,
  type PlaceInput,
  type ProfileInput,
  toPeople,
  toPlace,
} from "@/lib/db/convert";
import { type Result } from "@/lib/places/validation";
import { availabilityGrid } from "@/lib/scheduling/availabilityGrid";
import { findMeetups } from "@/lib/scheduling/findMeetups";
import {
  ceilToMinutes,
  localDay,
  MEETUP_PERIODS,
  type MeetupPeriod,
  periodRange,
} from "@/lib/scheduling/period";
import { minutesBetween, TIME_ZONE } from "@/lib/scheduling/time";
import { prefetchRequestsFor, type TravelTimeProvider } from "@/lib/scheduling/travel";
import type { DateRange, DayHours, MeetupProposal, Person, PersonId } from "@/lib/scheduling/types";
import { formatClockFr, parseClock } from "@/lib/scheduling/weeklyBlocks";

/** Durées minimales proposées, en minutes. */
export const MEETUP_DURATIONS = [30, 45, 60, 90, 120] as const;
export type MeetupDuration = (typeof MEETUP_DURATIONS)[number];

/** Marge par défaut ajoutée à chaque trajet, en minutes. */
export const DEFAULT_BUFFER_MINUTES = 5;
/** Marge maximale acceptée, en minutes. */
export const MAX_BUFFER_MINUTES = 30;
/**
 * Propositions gardées par jour. Plus que le défaut de findMeetups (3) : une courte pause
 * commune au cégep (ex. 30 min mardi midi, prédite au segment 4) a un score plus bas que les
 * longues soirées et serait sinon coupée. L'interface montre d'abord les meilleures.
 */
export const MAX_PROPOSALS_PER_DAY = 5;

/** Nombre maximal de participants d'une recherche (borne le coût du calcul). */
export const MAX_PARTICIPANTS = 20;

/**
 * Lieux essayés au plus par une recherche. Chaque lieu candidat est essayé pour chaque jour et
 * chaque participant : sans borne, quelqu'un qui crée des milliers de lieux (par l'API REST)
 * bloquerait le serveur plusieurs secondes à chaque recherche. Au-delà, on garde les maisons,
 * puis les favoris du groupe, puis les autres lieux de chacun à tour de rôle.
 */
export const MAX_CANDIDATE_PLACES = 80;

/** Blocs d'horaire des participants dans la période, au plus (même raison). */
export const MAX_SEARCH_BLOCKS = 4000;

/** Demande validée. */
export interface MeetupSearchInput {
  groupId: string;
  participantIds: string[];
  period: MeetupPeriod;
  durationMinutes: MeetupDuration;
  bufferMinutes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valide la demande envoyée par le formulaire (rien n'est supposé sur sa forme). */
export function validateMeetupSearch(raw: unknown): Result<MeetupSearchInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Demande invalide." };
  const r = raw as Record<string, unknown>;

  if (typeof r.groupId !== "string" || !UUID.test(r.groupId)) {
    return { ok: false, error: "Groupe introuvable." };
  }
  if (!Array.isArray(r.participantIds)) return { ok: false, error: "Choisis les participants." };
  if (r.participantIds.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `Au plus ${MAX_PARTICIPANTS} participants.` };
  }
  const ids: string[] = [];
  for (const id of r.participantIds) {
    if (typeof id !== "string" || !UUID.test(id)) {
      return { ok: false, error: "Participant introuvable." };
    }
    const lower = id.toLowerCase();
    if (!ids.includes(lower)) ids.push(lower);
  }
  if (ids.length < 2) return { ok: false, error: "Choisis au moins deux participants." };

  if (typeof r.period !== "string" || !MEETUP_PERIODS.includes(r.period as MeetupPeriod)) {
    return { ok: false, error: "Période invalide." };
  }
  if (!MEETUP_DURATIONS.includes(r.durationMinutes as MeetupDuration)) {
    return { ok: false, error: "Durée invalide (30, 45, 60, 90 ou 120 min)." };
  }
  const buffer = r.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  if (
    typeof buffer !== "number" ||
    !Number.isInteger(buffer) ||
    buffer < 0 ||
    buffer > MAX_BUFFER_MINUTES
  ) {
    return { ok: false, error: `La marge doit être entre 0 et ${MAX_BUFFER_MINUTES} min.` };
  }
  return {
    ok: true,
    value: {
      groupId: r.groupId.toLowerCase(),
      participantIds: ids,
      period: r.period as MeetupPeriod,
      durationMinutes: r.durationMinutes as MeetupDuration,
      bufferMinutes: buffer,
    },
  };
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Lectures nécessaires, toujours au nom de la personne connectée (RLS). Chaque méthode
 * correspond à une requête supabase-js (voir src/app/groupes/meetup-actions.ts).
 */
export interface MeetupStore {
  /** Membres du groupe (vide si je n'en fais pas partie : RLS de `group_members`). */
  memberIds(groupId: string): Promise<StoreResult<string[]>>;
  /** Profils (nom, mode de transport, maison, heures « je ne sors pas »). */
  profiles(ids: string[]): Promise<StoreResult<ProfileInput[]>>;
  /** Lieux personnels (`group_id` nul) de ces personnes, ceux que la RLS laisse voir. */
  personalPlaces(ownerIds: string[]): Promise<StoreResult<PlaceInput[]>>;
  /** Lieux favoris de ce groupe. */
  groupPlaces(groupId: string): Promise<StoreResult<PlaceInput[]>>;
  /** Blocs des membres par `group_busy_blocks(gid)` (titres masqués selon leur choix). */
  groupBlocks(groupId: string): Promise<StoreResult<BusyBlockInput[]>>;
}

/** Trajet d'une personne pour une proposition. */
export interface TravelView {
  personId: string;
  name: string;
  /** Aller (minutes, sans la marge). */
  to: number;
  /** Retour vers son lieu suivant (minutes, sans la marge). */
  from: number;
}

/** Proposition prête à afficher (sérialisable). */
export interface ProposalView {
  key: string;
  kind: "in-person" | "call";
  placeId: string | null;
  placeName: string | null;
  start: string;
  end: string;
  /** « mardi 16 septembre » */
  dayLabel: string;
  /** « 12 h – 12 h 30 » */
  timeLabel: string;
  durationMinutes: number;
  travel: TravelView[];
  score: number;
}

/** Ligne de la grille (sérialisable). */
export interface GridDayView {
  day: string;
  dayLabel: string;
  slots: { start: string; label: string; free: string[] }[];
}

/** Participant écarté du calcul, avec la raison affichée. */
export interface ExcludedView {
  id: string;
  name: string;
  reason: string;
}

export interface MeetupSearchView {
  range: DateRange;
  participants: { id: string; name: string }[];
  excluded: ExcludedView[];
  /** Propositions en personne, de la meilleure à la moins bonne. */
  inPerson: ProposalView[];
  /** Appels proposés les jours sans rencontre en personne possible. */
  calls: ProposalView[];
  /** Blocs dont le lieu n'est pas visible (supposés à la maison), par nom de personne. */
  hiddenPlaceBlocks: { name: string; count: number }[];
  grid: GridDayView[];
  /** Durée du calcul (findMeetups + grille), en millisecondes. */
  computeMs: number;
}

export interface SearchDeps {
  /** Personne connectée. */
  userId: string;
  /** Maintenant (injecté pour les tests). */
  now: Date;
  travel: TravelTimeProvider;
  /** Heures considérées (défaut de findMeetups : 8 h à 22 h). */
  dayHours?: DayHours;
  /** Horloge pour mesurer le calcul (défaut : performance.now). */
  clock?: () => number;
}

const NOT_MEMBER = "Groupe introuvable.";

/**
 * Cherche les moments réalistes pour les participants choisis d'un groupe.
 * Refuse si la personne connectée n'est pas membre, ou si un participant n'est pas membre.
 */
export async function searchGroupMeetups(
  store: MeetupStore,
  input: MeetupSearchInput,
  deps: SearchDeps,
): Promise<Result<MeetupSearchView>> {
  const members = await store.memberIds(input.groupId);
  if (!members.ok) return members;
  if (!members.value.includes(deps.userId)) return { ok: false, error: NOT_MEMBER };
  const memberSet = new Set(members.value);
  if (input.participantIds.some((id) => !memberSet.has(id))) {
    return { ok: false, error: "Un des participants ne fait pas partie du groupe." };
  }

  const range = periodRange(input.period, localDay(deps.now));
  const ids = input.participantIds;
  const [profiles, personal, favorites, blocks] = await Promise.all([
    store.profiles(ids),
    store.personalPlaces(ids),
    store.groupPlaces(input.groupId),
    store.groupBlocks(input.groupId),
  ]);
  if (!profiles.ok) return profiles;
  if (!personal.ok) return personal;
  if (!favorites.ok) return favorites;
  if (!blocks.ok) return blocks;

  const idSet = new Set(ids);
  // Défense en profondeur : on ne garde que les lignes des participants et du groupe.
  const profileRows = profiles.value.filter((p) => idSet.has(p.id));
  const personalRows = personal.value.filter((p) => idSet.has(p.owner_id));
  const blockRows = blocks.value.filter((b) => idSet.has(b.owner_id));
  if (blockRows.filter((b) => blockTouchesRange(b, range)).length > MAX_SEARCH_BLOCKS) {
    return {
      ok: false,
      error:
        "L'horaire des participants a trop de blocs pour ce calcul. Choisis moins de participants.",
    };
  }
  const placeRows = dedupeById([...personalRows, ...favorites.value]);

  const nameOf = new Map(profileRows.map((p) => [p.id, p.display_name || "Sans nom"]));
  const excluded: ExcludedView[] = ids
    .filter((id) => !nameOf.has(id))
    .map((id) => ({ id, name: "Membre", reason: "profil illisible" }));

  const knownPlaceIds = new Set(placeRows.map((p) => p.id));
  const hiddenCount = new Map<string, number>();
  for (const b of blockRows) {
    if (b.place_id && !knownPlaceIds.has(b.place_id)) {
      hiddenCount.set(b.owner_id, (hiddenCount.get(b.owner_id) ?? 0) + 1);
    }
  }

  // L'ordre des participants suit la demande (affichage des trajets stable).
  const ordered = ids.flatMap((id) => profileRows.filter((p) => p.id === id));
  const converted = toPeople(ordered, placeRows, blockRows, range);
  for (const inc of converted.incomplete) {
    excluded.push({
      id: inc.id,
      name: nameOf.get(inc.id) ?? inc.name,
      reason: "n'a pas encore choisi son lieu « maison »",
    });
  }
  const people = converted.people;
  const participants = people.map((p) => ({ id: p.id, name: p.name || "Sans nom" }));
  const displayName = new Map(participants.map((p) => [p.id, p.name]));

  const base: MeetupSearchView = {
    range,
    participants,
    excluded,
    inPerson: [],
    calls: [],
    hiddenPlaceBlocks: [...hiddenCount]
      .filter(([id]) => displayName.has(id))
      .map(([id, count]) => ({ name: displayName.get(id) ?? "Membre", count })),
    grid: [],
    computeMs: 0,
  };
  if (people.length < 2) return { ok: true, value: base };

  const favoritePlaces = favorites.value.map(toPlace);
  const candidatePlaceIds = limitCandidatePlaces(people, favorites.value, MAX_CANDIDATE_PLACES);
  // Vrais temps de trajet (segment 15) : préparés AVANT le calcul, en quelques appels bornés ;
  // findMeetups n'attend jamais le réseau. Sans clé d'API, `prefetch` n'existe pas.
  if (deps.travel.prefetch) {
    await deps.travel
      .prefetch(prefetchRequestsFor(people, favoritePlaces, candidatePlaceIds), {
        budgetKey: deps.userId,
      })
      .catch((e: unknown) => console.warn("Temps de trajet (préparation) :", e));
  }

  const clock = deps.clock ?? (() => performance.now());
  const t0 = clock();
  const proposals = await findMeetups(
    people,
    {
      personIds: people.map((p) => p.id),
      dates: range,
      minDurationMinutes: input.durationMinutes,
      bufferMinutes: input.bufferMinutes,
      favoritePlaces,
      candidatePlaceIds,
      dayHours: deps.dayHours,
      notBefore: ceilToMinutes(deps.now, 15),
    },
    deps.travel,
    { maxPerDay: MAX_PROPOSALS_PER_DAY },
  );
  const grid = availabilityGrid(people, range, { dayHours: deps.dayHours });
  const computeMs = clock() - t0;

  const placeName = new Map(placeRows.map((p) => [p.id, p.name]));
  const views = proposals.map((p, i) => toView(p, i, placeName, displayName, participants));
  return {
    ok: true,
    value: {
      ...base,
      inPerson: views.filter((v) => v.kind === "in-person"),
      calls: views.filter((v) => v.kind === "call"),
      grid: grid.map((d) => ({
        day: d.day,
        dayLabel: dayLabel(d.slots[0]?.start ?? new Date(`${d.day}T12:00:00Z`)),
        slots: d.slots.map((s) => ({
          start: s.start.toISOString(),
          label: `${clockLabel(s.start)} – ${clockLabel(s.end)}`,
          free: s.freeIds.map((id) => displayName.get(id) ?? "?"),
        })),
      })),
      computeMs,
    },
  };
}

/** Le bloc peut-il tomber dans la période ? (ponctuel : son jour ; hebdomadaire : sa validité) */
function blockTouchesRange(b: BusyBlockInput, range: DateRange): boolean {
  if (b.weekday === null) {
    return b.valid_from !== null && b.valid_from >= range.from && b.valid_from <= range.to;
  }
  return (
    (b.valid_until === null || b.valid_until >= range.from) &&
    (b.valid_from === null || b.valid_from <= range.to)
  );
}

/**
 * Lieux candidats à passer à findMeetups, ou `undefined` (tous les lieux, comportement par
 * défaut) quand il y en a au plus `max`. Sinon : les maisons, puis les favoris du groupe, puis
 * les autres lieux de chaque participant à tour de rôle, jusqu'à `max`.
 */
export function limitCandidatePlaces(
  people: readonly Person[],
  favorites: readonly PlaceInput[],
  max: number,
): string[] | undefined {
  const all = new Set<string>();
  for (const person of people) for (const p of person.places) all.add(p.id);
  for (const f of favorites) all.add(f.id);
  if (all.size <= max) return undefined;

  const chosen = new Set<string>();
  const add = (id: string) => {
    if (chosen.size < max) chosen.add(id);
  };
  for (const person of people) add(person.homePlaceId);
  for (const f of favorites) add(f.id);
  const longest = Math.max(0, ...people.map((p) => p.places.length));
  for (let i = 0; i < longest && chosen.size < max; i++) {
    for (const person of people) {
      const place = person.places[i];
      if (place) add(place.id);
    }
  }
  return [...chosen];
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) seen.set(r.id, r);
  return [...seen.values()];
}

/** « mardi 16 septembre » (fuseau de l'app). */
export function dayLabel(instant: Date): string {
  return formatInTimeZone(instant, TIME_ZONE, "EEEE d MMMM", { locale: frCA });
}

/** « 12 h 30 » (fuseau de l'app ; minuit → « minuit »). */
export function clockLabel(instant: Date): string {
  const minutes = parseClock(formatInTimeZone(instant, TIME_ZONE, "HH:mm"));
  return minutes === null ? "" : formatClockFr(minutes);
}

function toView(
  p: MeetupProposal,
  index: number,
  placeName: ReadonlyMap<string, string>,
  displayName: ReadonlyMap<PersonId, string>,
  participants: { id: string; name: string }[],
): ProposalView {
  return {
    key: `${p.kind}-${p.placeId ?? "appel"}-${p.start.toISOString()}-${index}`,
    kind: p.kind,
    placeId: p.placeId,
    placeName: p.placeId ? (placeName.get(p.placeId) ?? "Lieu") : null,
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    dayLabel: dayLabel(p.start),
    timeLabel: `${clockLabel(p.start)} – ${clockLabel(p.end)}`,
    durationMinutes: Math.round(minutesBetween(p.start, p.end)),
    travel: participants.map(({ id }) => ({
      personId: id,
      name: displayName.get(id) ?? "?",
      to: p.travelByPerson[id]?.to ?? 0,
      from: p.travelByPerson[id]?.from ?? 0,
    })),
    score: Math.round(p.score * 100) / 100,
  };
}
