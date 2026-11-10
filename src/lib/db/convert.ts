/**
 * Conversion des lignes de la BD (telles que renvoyées par supabase-js) vers les types purs de
 * `src/lib/scheduling`. Fonctions pures : aucun accès BD ici.
 *
 * Les blocs hebdomadaires sont « dépliés » en blocs datés sur une plage de jours locaux
 * (fuseau America/Toronto). Les heures stockées sont locales : un cours à 10 h reste à 10 h
 * après le changement d'heure (l'instant UTC, lui, change). Voir `zonedTime` pour les heures
 * qui n'existent pas ou existent deux fois.
 */
import { formatInTimeZone } from "date-fns-tz";

import {
  applyOneOffAvailability,
  type OneOffAvailability,
} from "@/lib/scheduling/oneOffAvailability";
import { quietHoursBlocks, quietHoursFromDb } from "@/lib/scheduling/quietHours";
import {
  type AcceptedStudySession,
  assertStudyPreferences,
  DEFAULT_STUDY_PREFERENCES,
} from "@/lib/scheduling/studyPlanner";
import { eachDay, TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import type {
  BusyBlock,
  DateRange,
  Deadline,
  Difficulty,
  Person,
  PersonId,
  Place,
  StudyPreferences,
  StudySession,
  TravelMode,
} from "@/lib/scheduling/types";
import { isValidEvery, REPEAT_UNITS, type RepeatUnit } from "@/lib/scheduling/recurrence";
import {
  type BlockDays,
  type BlockSpec,
  formatClock,
  isRecurring,
  occursOn,
  parseClock,
  type Weekday,
} from "@/lib/scheduling/weeklyBlocks";

import type {
  AvailabilitySlotRow,
  BusyBlockRow,
  DeadlineRow,
  PlaceRow,
  ProfileRow,
  StudyPreferencesRow,
} from "./schema";

/**
 * Colonnes utiles d'un profil. Les « heures où je ne sors pas » sont facultatives (absentes
 * avant la migration 0004 : pas de limite).
 */
export type ProfileInput = Pick<
  ProfileRow,
  "id" | "display_name" | "travel_mode" | "home_place_id"
> &
  Partial<Pick<ProfileRow, "unavailable_before" | "unavailable_after">>;
/** Colonnes utiles d'un lieu. */
export type PlaceInput = Pick<PlaceRow, "id" | "owner_id" | "name" | "lat" | "lng">;
/**
 * Colonnes utiles d'un bloc occupé. La répétition personnalisée (migration 0015) est
 * facultative : absente = 1 et pas d'unité (hebdomadaire simple ou ponctuel).
 */
export type BusyBlockInput = Pick<
  BusyBlockRow,
  | "id"
  | "owner_id"
  | "title"
  | "place_id"
  | "start_time"
  | "end_time"
  | "weekday"
  | "valid_from"
  | "valid_until"
> &
  Partial<Pick<BusyBlockRow, "repeat_unit" | "repeat_every">> & {
    /** Occurrences annulées (migration 0021) ; absentes avant. */
    skip_days?: string[] | null;
  };

/** Jours annulés d'une ligne (rien pour un bloc ponctuel ou avant la migration 0021). */
function skipDaysOf(row: Pick<BusyBlockInput, "skip_days">): { skipDays?: string[] } {
  return row.skip_days?.length ? { skipDays: row.skip_days } : {};
}

/** Champs de répétition d'une ligne (valeurs inconnues de la BD : erreur). */
function repeatOf(row: Pick<BusyBlockInput, "repeat_unit" | "repeat_every">): {
  repeatUnit: RepeatUnit | null;
  repeatEvery: number;
} {
  const unit = row.repeat_unit ?? null;
  if (unit !== null && !(REPEAT_UNITS as readonly string[]).includes(unit)) {
    throw new Error(`Unité de répétition invalide venant de la BD : ${unit}`);
  }
  const every = row.repeat_every ?? 1;
  if (!isValidEvery(every)) {
    throw new Error(`Intervalle de répétition invalide venant de la BD : ${every}`);
  }
  return { repeatUnit: unit as RepeatUnit | null, repeatEvery: every };
}

/** Champs qui décident des jours d'un bloc, à partir d'une ligne. */
function rowDays(row: BusyBlockInput): BlockDays {
  return {
    weekday: row.weekday == null ? null : (row.weekday as Weekday),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    ...repeatOf(row),
    ...skipDaysOf(row),
  };
}

/** Vrai si la ligne revient (hebdomadaire ou répétition personnalisée). */
export function isRecurringRow(row: Pick<BusyBlockInput, "weekday" | "repeat_unit">): boolean {
  return isRecurring({
    weekday: row.weekday == null ? null : (row.weekday as Weekday),
    repeatUnit: (row.repeat_unit ?? null) as RepeatUnit | null,
  });
}

const TIME_RE = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** « 10:00:00 » (format Postgres `time`) → « 10:00 ». Les secondes sont ignorées. */
export function toHHmm(pgTime: string): string {
  const m = TIME_RE.exec(pgTime);
  if (!m) throw new Error(`Heure invalide venant de la BD : ${pgTime}`);
  return `${m[1]}:${m[2]}`;
}

/** Ligne `busy_blocks` → `BlockSpec` (heures locales en minutes), pour /horaire. */
export function toBlockSpec(row: BusyBlockInput): BlockSpec {
  const start = parseClock(toHHmm(row.start_time));
  const end = parseClock(toHHmm(row.end_time));
  if (start === null || end === null) {
    throw new Error(`Heures invalides venant de la BD : ${row.start_time}–${row.end_time}`);
  }
  const weekday = row.weekday;
  if (weekday != null && !(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) {
    throw new Error(`Jour de semaine invalide venant de la BD : ${weekday}`);
  }
  return {
    id: row.id,
    title: row.title,
    placeId: row.place_id,
    startMinute: start,
    endMinute: end,
    weekday: weekday == null ? null : (weekday as Weekday),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    ...repeatOf(row),
    ...skipDaysOf(row),
  };
}

/** `BlockSpec` → colonnes à écrire dans `busy_blocks` (sans `id`, `owner_id` ni `source`). */
export function fromBlockSpec(
  spec: BlockSpec,
): Pick<
  BusyBlockRow,
  | "title"
  | "place_id"
  | "start_time"
  | "end_time"
  | "weekday"
  | "valid_from"
  | "valid_until"
  | "repeat_unit"
  | "repeat_every"
> {
  return {
    title: spec.title,
    place_id: spec.placeId,
    start_time: formatClock(spec.startMinute),
    end_time: formatClock(spec.endMinute),
    weekday: spec.weekday,
    valid_from: spec.validFrom,
    valid_until: spec.validUntil,
    repeat_unit: spec.repeatUnit ?? null,
    repeat_every: spec.repeatEvery ?? 1,
  };
}

/** Ligne `places` → `Place`. */
export function toPlace(row: PlaceInput): Place {
  return { id: row.id, name: row.name, lat: row.lat, lng: row.lng };
}

/**
 * Déplie un bloc (hebdomadaire, répétition personnalisée ou ponctuel) en blocs datés sur la
 * plage `range` (jours locaux inclus). Un bloc qui revient apparaît chaque jour de la plage où
 * il a lieu (`occursOn` : bon jour de semaine, une semaine sur X, même quantième du mois…) dans
 * sa période de validité `valid_from` → `valid_until` (incluses). Un bloc ponctuel apparaît si
 * son jour (`valid_from`) est dans la plage.
 *
 * `fallbackPlaceId` : lieu utilisé quand `place_id` est nul (lieu supprimé), en général la
 * maison. Identifiant d'un bloc déplié : `<id>@<jour>`.
 */
export function expandBusyBlock(
  row: BusyBlockInput,
  range: DateRange,
  fallbackPlaceId: string,
  timeZone: string = TIME_ZONE,
): BusyBlock[] {
  const startTime = toHHmm(row.start_time);
  const endTime = toHHmm(row.end_time);
  const placeId = row.place_id ?? fallbackPlaceId;

  const recurring = isRecurringRow(row);
  let days: string[];
  if (!recurring) {
    if (!row.valid_from) return [];
    days = row.valid_from >= range.from && row.valid_from <= range.to ? [row.valid_from] : [];
  } else {
    const from = row.valid_from && row.valid_from > range.from ? row.valid_from : range.from;
    const to = row.valid_until && row.valid_until < range.to ? row.valid_until : range.to;
    const rule = rowDays(row);
    days = from <= to ? eachDay(from, to).filter((d) => occursOn(rule, d)) : [];
  }

  const blocks: BusyBlock[] = [];
  for (const day of days) {
    const start = zonedTime(day, startTime, timeZone);
    const end = zonedTime(day, endTime, timeZone);
    // Bloc entièrement dans l'heure sautée en mars (ex. 2 h 15 → 2 h 45) : durée nulle.
    if (end <= start) continue;
    blocks.push({
      id: recurring ? `${row.id}@${day}` : row.id,
      start,
      end,
      placeId,
      title: row.title,
    });
  }
  return blocks;
}

/** Déplie tous les blocs sur la plage, triés par début. */
export function expandBusyBlocks(
  rows: BusyBlockInput[],
  range: DateRange,
  fallbackPlaceId: string,
  timeZone: string = TIME_ZONE,
): BusyBlock[] {
  return rows
    .flatMap((r) => expandBusyBlock(r, range, fallbackPlaceId, timeZone))
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
}

/** Raison pour laquelle un profil ne peut pas encore entrer dans le calcul. */
export type IncompleteReason = "no-home";

/** Résultat de `toPeople`. */
export interface PeopleResult {
  /** Personnes prêtes pour `findMeetups`. */
  people: Person[];
  /** Profils écartés (ex. pas de lieu maison choisi), avec la raison. */
  incomplete: { id: PersonId; name: string; reason: IncompleteReason }[];
}

/** Colonnes utiles d'une disponibilité ponctuelle (`group_availability_slots` : sans note). */
export type AvailabilitySlotInput = Pick<
  AvailabilitySlotRow,
  "id" | "owner_id" | "day" | "start_time" | "end_time"
>;

/** Ligne `availability_slots` → `OneOffAvailability` (heures locales « HH:mm »). */
export function toOneOffAvailability(row: AvailabilitySlotInput): OneOffAvailability {
  return { id: row.id, day: row.day, start: toHHmm(row.start_time), end: toHHmm(row.end_time) };
}

/** Options de `toPeople`. */
export interface ToPeopleOptions {
  /** Fuseau (défaut : America/Toronto). */
  timeZone?: string;
  /**
   * Disponibilités ponctuelles (segment 18), de toutes les personnes : appliquées à leur
   * propriétaire sur les jours de la plage (`applyOneOffAvailability`).
   */
  availabilities?: AvailabilitySlotInput[];
}

/**
 * Construit les `Person` de la logique d'horaire à partir des profils, lieux et blocs lus en
 * BD. Les lieux et blocs sont rattachés à leur propriétaire (`owner_id`). Un profil sans lieu
 * maison (ou dont la maison n'est pas dans ses lieux) est mis dans `incomplete`. Les « heures
 * où je ne sors pas » du profil deviennent des blocs occupés à la maison (`quietHoursBlocks`).
 * Les disponibilités ponctuelles lèvent, pendant leurs heures, les blocs hebdomadaires et les
 * heures « je ne sors pas », et rendent occupé le reste de leur journée.
 */
export function toPeople(
  profiles: ProfileInput[],
  places: PlaceInput[],
  blocks: BusyBlockInput[],
  range: DateRange,
  options: ToPeopleOptions = {},
): PeopleResult {
  const { timeZone = TIME_ZONE, availabilities = [] } = options;
  const placesByOwner = groupBy(places, (p) => p.owner_id);
  const blocksByOwner = groupBy(blocks, (b) => b.owner_id);
  const availabilitiesByOwner = groupBy(
    availabilities.filter((a) => a.day >= range.from && a.day <= range.to),
    (a) => a.owner_id,
  );
  const knownPlaceIds = new Set(places.map((p) => p.id));
  const result: PeopleResult = { people: [], incomplete: [] };

  for (const profile of profiles) {
    const own = placesByOwner.get(profile.id) ?? [];
    const home = profile.home_place_id;
    if (!home || !own.some((p) => p.id === home)) {
      result.incomplete.push({ id: profile.id, name: profile.display_name, reason: "no-home" });
      continue;
    }
    // Un lieu de bloc inconnu (supprimé, ou non fourni) est remplacé par la maison.
    const ownBlocks = (blocksByOwner.get(profile.id) ?? []).map((b) =>
      b.place_id && !knownPlaceIds.has(b.place_id) ? { ...b, place_id: null } : b,
    );
    const quiet = quietHoursFromDb(
      profile.unavailable_before ?? null,
      profile.unavailable_after ?? null,
    );
    const weekly = expandBusyBlocks(
      ownBlocks.filter((b) => isRecurringRow(b)),
      range,
      home,
      timeZone,
    );
    const oneOff = expandBusyBlocks(
      ownBlocks.filter((b) => !isRecurringRow(b)),
      range,
      home,
      timeZone,
    );
    const busyBlocks = applyOneOffAvailability(
      [...weekly, ...quietHoursBlocks(quiet, range, home, timeZone)],
      oneOff,
      (availabilitiesByOwner.get(profile.id) ?? []).map(toOneOffAvailability),
      home,
      timeZone,
    );
    // La logique exige que les lieux des blocs soient dans `places` : on ajoute ceux qui
    // viendraient d'un autre propriétaire (ex. lieu favori du groupe) s'ils sont fournis.
    const ownIds = new Set(own.map((p) => p.id));
    const extra = places.filter(
      (p) => !ownIds.has(p.id) && busyBlocks.some((b) => b.placeId === p.id),
    );
    result.people.push({
      id: profile.id,
      name: profile.display_name,
      homePlaceId: home,
      travelMode: profile.travel_mode satisfies TravelMode,
      busyBlocks,
      places: [...own, ...extra].map(toPlace),
    });
  }
  return result;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

// ─── Planificateur d'étude (segments 13 et 14) ───────────────────────────────────────────

/** Colonnes utiles d'une échéance. */
export type DeadlineInput = Pick<
  DeadlineRow,
  "id" | "kind" | "course" | "due_at" | "estimated_hours" | "difficulty"
>;

/** Ligne `deadlines` → `Deadline` (difficulté hors bornes : moyenne). */
export function toDeadline(row: DeadlineInput): Deadline {
  const dueAt = new Date(row.due_at);
  if (!Number.isFinite(dueAt.getTime())) {
    throw new Error(`Date d'échéance invalide venant de la BD : ${row.due_at}`);
  }
  const difficulty = [1, 2, 3].includes(row.difficulty) ? (row.difficulty as Difficulty) : 2;
  return {
    id: row.id,
    kind: row.kind,
    course: row.course,
    dueAt,
    estimatedHours: row.estimated_hours,
    difficulty,
  };
}

/** Colonnes utiles des préférences d'étude. */
export type StudyPreferencesInput = Pick<
  StudyPreferencesRow,
  | "min_session_minutes"
  | "max_session_minutes"
  | "max_minutes_per_day"
  | "break_minutes"
  | "study_start"
  | "study_end"
  | "eve_cutoff"
  | "keep_free_percent"
>;

/**
 * Ligne `study_preferences` → `StudyPreferences`. Pas de ligne (jamais réglées) ou valeurs
 * incohérentes : préférences par défaut. Début de soirée, marge et fenêtre : valeurs par défaut.
 */
export function toStudyPreferences(row: StudyPreferencesInput | null): StudyPreferences {
  if (!row) return DEFAULT_STUDY_PREFERENCES;
  const prefs: StudyPreferences = {
    ...DEFAULT_STUDY_PREFERENCES,
    minSessionMinutes: row.min_session_minutes,
    maxSessionMinutes: row.max_session_minutes,
    maxStudyMinutesPerDay: row.max_minutes_per_day,
    breakMinutes: row.break_minutes,
    studyHours: { start: toHHmm(row.study_start), end: toHHmm(row.study_end) },
    eveCutoff: row.eve_cutoff ? toHHmm(row.eve_cutoff) : null,
    keepFreeRatio: row.keep_free_percent / 100,
  };
  try {
    assertStudyPreferences(prefs);
    return prefs;
  } catch {
    return DEFAULT_STUDY_PREFERENCES;
  }
}

/** `StudyPreferences` → colonnes de `study_preferences` (sans `owner_id`). */
export function fromStudyPreferences(p: StudyPreferences): StudyPreferencesInput {
  return {
    min_session_minutes: p.minSessionMinutes,
    max_session_minutes: p.maxSessionMinutes,
    max_minutes_per_day: p.maxStudyMinutesPerDay,
    break_minutes: p.breakMinutes,
    study_start: p.studyHours.start,
    study_end: p.studyHours.end,
    eve_cutoff: p.eveCutoff,
    keep_free_percent: Math.round(p.keepFreeRatio * 100),
  };
}

/** Colonnes utiles d'un bloc pour l'étude : bloc + origine, échéance et « déplaçable ». */
export type StudyBlockInput = BusyBlockInput &
  Pick<BusyBlockRow, "source"> &
  Partial<Pick<BusyBlockRow, "deadline_id" | "movable">>;

/** Préfixes des titres des séances (le reste : nom du cours). */
export const STUDY_TITLE_PREFIX = { study: "Étude : ", review: "Révision : " } as const;

/** Titre d'une séance enregistrée : « Étude : Chimie », « Révision : Chimie » (≤ 100). */
export function studySessionTitle(kind: StudySession["kind"], course: string): string {
  return `${STUDY_TITLE_PREFIX[kind]}${course}`.slice(0, 100);
}

/**
 * Bloc `source = 'study'` → séance acceptée (instants absolus). `null` si ce n'est pas une
 * séance valable (pas d'échéance, bloc hebdomadaire, heures impossibles). Lieu nul : maison.
 */
export function toAcceptedSession(
  row: StudyBlockInput,
  homePlaceId: string,
  timeZone: string = TIME_ZONE,
): AcceptedStudySession | null {
  if (row.source !== "study" || !row.deadline_id || isRecurringRow(row) || !row.valid_from) {
    return null;
  }
  const start = zonedTime(row.valid_from, toHHmm(row.start_time), timeZone);
  const end = zonedTime(row.valid_from, toHHmm(row.end_time), timeZone);
  if (end <= start) return null;
  return {
    id: row.id,
    deadlineId: row.deadline_id,
    start,
    end,
    placeId: row.place_id ?? homePlaceId,
    kind: row.title.startsWith(STUDY_TITLE_PREFIX.review) ? "review" : "study",
    movable: row.movable ?? false,
  };
}

/** Colonnes d'une séance à écrire dans `busy_blocks` (heures locales, bloc ponctuel). */
export interface StudyBlockRow {
  title: string;
  place_id: string;
  start_time: string;
  end_time: string;
  weekday: null;
  valid_from: string;
  valid_until: string;
}

/**
 * Séance → colonnes de `busy_blocks` (jour et heures locales). Une séance qui finit pile à
 * minuit finit à « 24:00 ». Lève une erreur si elle traverse minuit.
 */
export function studySessionToRow(
  session: Pick<StudySession, "start" | "end" | "placeId">,
  title: string,
  timeZone: string = TIME_ZONE,
): StudyBlockRow {
  const day = formatInTimeZone(session.start, timeZone, "yyyy-MM-dd");
  const start = formatInTimeZone(session.start, timeZone, "HH:mm");
  const endDay = formatInTimeZone(session.end, timeZone, "yyyy-MM-dd");
  let end = formatInTimeZone(session.end, timeZone, "HH:mm");
  if (endDay !== day) {
    if (end !== "00:00" || zonedTime(day, "24:00", timeZone).getTime() !== session.end.getTime()) {
      throw new Error("Une séance ne traverse pas minuit.");
    }
    end = "24:00";
  }
  return {
    title,
    place_id: session.placeId,
    start_time: start,
    end_time: end,
    weekday: null,
    valid_from: day,
    valid_until: day,
  };
}
