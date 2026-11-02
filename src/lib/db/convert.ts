/**
 * Conversion des lignes de la BD (telles que renvoyées par supabase-js) vers les types purs de
 * `src/lib/scheduling`. Fonctions pures : aucun accès BD ici.
 *
 * Les blocs hebdomadaires sont « dépliés » en blocs datés sur une plage de jours locaux
 * (fuseau America/Toronto). Les heures stockées sont locales : un cours à 10 h reste à 10 h
 * après le changement d'heure (l'instant UTC, lui, change). Voir `zonedTime` pour les heures
 * qui n'existent pas ou existent deux fois.
 */
import { getISODay, parseISO } from "date-fns";

import { eachDay, TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import type {
  BusyBlock,
  DateRange,
  Person,
  PersonId,
  Place,
  TravelMode,
} from "@/lib/scheduling/types";

import type { BusyBlockRow, PlaceRow, ProfileRow } from "./schema";

/** Colonnes utiles d'un profil. */
export type ProfileInput = Pick<
  ProfileRow,
  "id" | "display_name" | "travel_mode" | "home_place_id"
>;
/** Colonnes utiles d'un lieu. */
export type PlaceInput = Pick<PlaceRow, "id" | "owner_id" | "name" | "lat" | "lng">;
/** Colonnes utiles d'un bloc occupé. */
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
>;

const TIME_RE = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** « 10:00:00 » (format Postgres `time`) → « 10:00 ». Les secondes sont ignorées. */
export function toHHmm(pgTime: string): string {
  const m = TIME_RE.exec(pgTime);
  if (!m) throw new Error(`Heure invalide venant de la BD : ${pgTime}`);
  return `${m[1]}:${m[2]}`;
}

/** Ligne `places` → `Place`. */
export function toPlace(row: PlaceInput): Place {
  return { id: row.id, name: row.name, lat: row.lat, lng: row.lng };
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'un jour `yyyy-MM-dd`. */
function isoWeekday(day: string): number {
  return getISODay(parseISO(day));
}

/**
 * Déplie un bloc (hebdomadaire ou ponctuel) en blocs datés sur la plage `range` (jours
 * locaux inclus). Un bloc hebdomadaire apparaît chaque jour de la plage qui tombe le bon jour
 * de semaine et dans sa période de validité `valid_from` → `valid_until` (incluses). Un bloc
 * ponctuel apparaît si son jour (`valid_from`) est dans la plage.
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

  let days: string[];
  if (row.weekday == null) {
    if (!row.valid_from) return [];
    days = row.valid_from >= range.from && row.valid_from <= range.to ? [row.valid_from] : [];
  } else {
    const from = row.valid_from && row.valid_from > range.from ? row.valid_from : range.from;
    const to = row.valid_until && row.valid_until < range.to ? row.valid_until : range.to;
    days = from <= to ? eachDay(from, to).filter((d) => isoWeekday(d) === row.weekday) : [];
  }

  const blocks: BusyBlock[] = [];
  for (const day of days) {
    const start = zonedTime(day, startTime, timeZone);
    const end = zonedTime(day, endTime, timeZone);
    // Bloc entièrement dans l'heure sautée en mars (ex. 2 h 15 → 2 h 45) : durée nulle.
    if (end <= start) continue;
    blocks.push({
      id: row.weekday == null ? row.id : `${row.id}@${day}`,
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

/**
 * Construit les `Person` de la logique d'horaire à partir des profils, lieux et blocs lus en
 * BD. Les lieux et blocs sont rattachés à leur propriétaire (`owner_id`). Un profil sans lieu
 * maison (ou dont la maison n'est pas dans ses lieux) est mis dans `incomplete`.
 */
export function toPeople(
  profiles: ProfileInput[],
  places: PlaceInput[],
  blocks: BusyBlockInput[],
  range: DateRange,
  timeZone: string = TIME_ZONE,
): PeopleResult {
  const placesByOwner = groupBy(places, (p) => p.owner_id);
  const blocksByOwner = groupBy(blocks, (b) => b.owner_id);
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
    const busyBlocks = expandBusyBlocks(ownBlocks, range, home, timeZone);
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
