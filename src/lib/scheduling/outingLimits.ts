/**
 * Limite de sorties : « pas plus d'une sortie par jour », « pas plus de 3 par semaine ». Une
 * sortie est un plan de groupe accepté (ou proposé par moi). Quand la limite d'un jour ou
 * d'une semaine (lundi → dimanche) est atteinte, la personne compte comme occupée à la maison
 * tout le jour : l'app ne propose plus rien ce jour-là. Fonctions pures (sans BD ni React).
 */
import { formatInTimeZone } from "date-fns-tz";

import { eachDay, TIME_ZONE, zonedDayBounds } from "./time";
import type { BusyBlock, DateRange, PlaceId } from "./types";
import { shiftDay, type ValidationResult, weekStart } from "./weeklyBlocks";

export interface OutingLimits {
  /** Sorties par jour au plus (`null` : pas de limite). */
  perDay: number | null;
  /** Sorties par semaine au plus, du lundi au dimanche (`null` : pas de limite). */
  perWeek: number | null;
}

export const NO_OUTING_LIMITS: OutingLimits = { perDay: null, perWeek: null };

/** Bornes acceptées (les mêmes que les CHECK de la BD, migration 0022). */
export const OUTING_LIMIT_RANGE = {
  perDay: { min: 1, max: 5 },
  perWeek: { min: 1, max: 21 },
} as const;

function inRange(v: unknown, r: { min: number; max: number }): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;
}

/** Valide le réglage envoyé par le formulaire (`""` ou `null` : pas de limite). */
export function validateOutingLimits(raw: unknown): ValidationResult<OutingLimits> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Réglage invalide." };
  const r = raw as Record<string, unknown>;
  const read = (v: unknown, range: { min: number; max: number }): number | null | undefined => {
    if (v == null || v === "") return null;
    const n = typeof v === "string" && /^\d{1,2}$/.test(v) ? Number(v) : v;
    return inRange(n, range) ? n : undefined;
  };
  const perDay = read(r.perDay, OUTING_LIMIT_RANGE.perDay);
  const perWeek = read(r.perWeek, OUTING_LIMIT_RANGE.perWeek);
  if (perDay === undefined || perWeek === undefined) {
    return { ok: false, error: "Limite de sorties invalide." };
  }
  return { ok: true, value: { perDay, perWeek } };
}

/** Valeurs de la BD → `OutingLimits`. Absente ou invalide → pas de limite. */
export function outingLimitsFromDb(
  perDay: number | null | undefined,
  perWeek: number | null | undefined,
): OutingLimits {
  return {
    perDay: inRange(perDay, OUTING_LIMIT_RANGE.perDay) ? perDay : null,
    perWeek: inRange(perWeek, OUTING_LIMIT_RANGE.perWeek) ? perWeek : null,
  };
}

/** Vrai si au moins une limite est réglée. */
export function hasOutingLimit(limits: OutingLimits): boolean {
  return limits.perDay !== null || limits.perWeek !== null;
}

/**
 * Plage de jours à lire pour compter les sorties des semaines touchées par `range` : du lundi
 * de la première semaine au dimanche de la dernière.
 */
export function outingCountRange(range: DateRange): DateRange {
  return { from: weekStart(range.from), to: shiftDay(weekStart(range.to), 6) };
}

/**
 * Jours de `range` où la personne a atteint sa limite. `outings` : ses sorties dépliées sur
 * `outingCountRange(range)` (une sortie compte le jour local où elle commence).
 */
export function daysAtOutingLimit(
  outings: readonly Pick<BusyBlock, "start">[],
  limits: OutingLimits,
  range: DateRange,
  timeZone: string = TIME_ZONE,
): string[] {
  if (!hasOutingLimit(limits) || outings.length === 0 || range.from > range.to) return [];
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const o of outings) {
    const day = formatInTimeZone(o.start, timeZone, "yyyy-MM-dd");
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const week = weekStart(day);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  return eachDay(range.from, range.to).filter(
    (day) =>
      (limits.perDay !== null && (perDay.get(day) ?? 0) >= limits.perDay) ||
      (limits.perWeek !== null && (perWeek.get(weekStart(day)) ?? 0) >= limits.perWeek),
  );
}

/**
 * Blocs occupés « limite de sorties atteinte » : un bloc de minuit à minuit, à la maison, pour
 * chaque jour de `range` où la limite est atteinte (23, 24 ou 25 h selon le changement
 * d'heure). Identifiant : `limite-sorties@<jour>`.
 */
export function outingLimitBlocks(
  outings: readonly Pick<BusyBlock, "start">[],
  limits: OutingLimits,
  range: DateRange,
  homePlaceId: PlaceId,
  timeZone: string = TIME_ZONE,
): BusyBlock[] {
  return daysAtOutingLimit(outings, limits, range, timeZone).map((day) => {
    const { start, end } = zonedDayBounds(day, timeZone);
    return { id: `limite-sorties@${day}`, start, end, placeId: homePlaceId, title: "" };
  });
}
