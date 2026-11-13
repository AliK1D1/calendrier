/**
 * Périodes de recherche proposées dans « Quand on peut se voir » (fonctions pures).
 * Les jours sont des jours locaux (America/Toronto), semaines du lundi au dimanche.
 */
import { formatInTimeZone } from "date-fns-tz";

import { TIME_ZONE } from "./time";
import type { DateRange } from "./types";
import { shiftDay, weekStart } from "./weeklyBlocks";

/** Cette semaine (d'aujourd'hui à dimanche) ou la semaine prochaine (lundi à dimanche). */
export type MeetupPeriod = "this-week" | "next-week";

export const MEETUP_PERIODS: readonly MeetupPeriod[] = ["this-week", "next-week"];

/** Libellés affichés. */
export const MEETUP_PERIOD_LABELS: Record<MeetupPeriod, string> = {
  "this-week": "Cette semaine",
  "next-week": "La semaine prochaine",
};

/** Jour local (« yyyy-MM-dd ») d'un instant. */
export function localDay(instant: Date, timeZone: string = TIME_ZONE): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

/**
 * Jours couverts par une période, à partir du jour local `today`.
 * - « cette semaine » : d'aujourd'hui au dimanche (les jours passés ne servent à rien) ;
 * - « la semaine prochaine » : du lundi suivant au dimanche suivant.
 */
export function periodRange(period: MeetupPeriod, today: string): DateRange {
  const monday = weekStart(today);
  if (period === "this-week") return { from: today, to: shiftDay(monday, 6) };
  return { from: shiftDay(monday, 7), to: shiftDay(monday, 13) };
}

/** Arrondit un instant au quart d'heure suivant (créneaux plus lisibles : 14 h 15, pas 14 h 07). */
export function ceilToMinutes(instant: Date, step: number = 15): Date {
  const ms = step * 60_000;
  return new Date(Math.ceil(instant.getTime() / ms) * ms);
}
