/**
 * « Heures où je ne sors pas » (ex. pas avant 9 h, pas après 22 h), réglées dans /profil.
 * La logique les traite comme des **blocs occupés à la maison**, chaque jour : la personne
 * part de chez elle au plus tôt à 9 h et doit y être revenue à 22 h. Fonctions pures.
 */
import { eachDay, TIME_ZONE, zonedTime } from "./time";
import type { BusyBlock, DateRange, PlaceId } from "./types";
import { formatClock, MINUTES_PER_DAY, parseClock, type ValidationResult } from "./weeklyBlocks";

/** Limites en minutes depuis minuit (heure locale) ; `null` = pas de limite. */
export interface QuietHours {
  /** Je ne sors pas avant… (ex. 540 = 9 h). */
  before: number | null;
  /** Je ne sors pas après… (ex. 1320 = 22 h). */
  after: number | null;
}

export const NO_QUIET_HOURS: QuietHours = { before: null, after: null };

/**
 * Valide le réglage envoyé par le formulaire : `{ before: "HH:mm" | "", after: "HH:mm" | "" }`
 * (chaîne vide = pas de limite). « Pas avant » entre 00:15 et 23:45, « pas après » entre
 * 00:15 et 23:45, et il doit rester du temps entre les deux.
 */
export function validateQuietHours(raw: unknown): ValidationResult<QuietHours> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Réglage invalide." };
  const r = raw as Record<string, unknown>;
  const read = (v: unknown): number | null | undefined => {
    if (v == null || v === "") return null;
    if (typeof v !== "string") return undefined;
    const m = parseClock(v);
    return m === null || m <= 0 || m >= MINUTES_PER_DAY ? undefined : m;
  };
  const before = read(r.before);
  const after = read(r.after);
  if (before === undefined || after === undefined) return { ok: false, error: "Heure invalide." };
  if (before !== null && after !== null && after <= before) {
    return { ok: false, error: "L'heure de fin doit être après l'heure de début." };
  }
  return { ok: true, value: { before, after } };
}

/** Valeurs de la BD (`time`, ex. « 09:00:00 » ou nul) → `QuietHours`. Invalide → pas de limite. */
export function quietHoursFromDb(before: string | null, after: string | null): QuietHours {
  const read = (v: string | null) => {
    if (v == null) return null;
    const m = parseClock(v.slice(0, 5));
    return m === null || m <= 0 || m >= MINUTES_PER_DAY ? null : m;
  };
  const q = { before: read(before), after: read(after) };
  return q.before !== null && q.after !== null && q.after <= q.before ? NO_QUIET_HOURS : q;
}

/** `QuietHours` → valeurs pour la BD (« HH:mm » ou nul). */
export function quietHoursToDb(q: QuietHours): {
  unavailable_before: string | null;
  unavailable_after: string | null;
} {
  return {
    unavailable_before: q.before === null ? null : formatClock(q.before),
    unavailable_after: q.after === null ? null : formatClock(q.after),
  };
}

/**
 * Blocs occupés « je ne sors pas » sur la plage de jours locaux `range` : chaque jour, de
 * minuit à `before` et de `after` à minuit, à la maison. Les instants sont calculés dans le
 * fuseau : le jour du changement d'heure, « avant 9 h » dure 10 h (novembre) ou 8 h (mars).
 * Identifiants : `calme-avant@<jour>` et `calme-apres@<jour>`.
 */
export function quietHoursBlocks(
  quiet: QuietHours,
  range: DateRange,
  homePlaceId: PlaceId,
  timeZone: string = TIME_ZONE,
): BusyBlock[] {
  if (quiet.before === null && quiet.after === null) return [];
  const blocks: BusyBlock[] = [];
  for (const day of eachDay(range.from, range.to)) {
    if (quiet.before !== null) {
      blocks.push({
        id: `calme-avant@${day}`,
        start: zonedTime(day, "00:00", timeZone),
        end: zonedTime(day, formatClock(quiet.before), timeZone),
        placeId: homePlaceId,
        title: "Je ne sors pas",
      });
    }
    if (quiet.after !== null) {
      blocks.push({
        id: `calme-apres@${day}`,
        start: zonedTime(day, formatClock(quiet.after), timeZone),
        end: zonedTime(day, "24:00", timeZone),
        placeId: homePlaceId,
        title: "Je ne sors pas",
      });
    }
  }
  return blocks;
}
