/**
 * Formats de dates et d'heures selon la langue (fonctions pures). Les heures sont données en
 * minutes depuis minuit (heure locale America/Toronto), comme dans `src/lib/scheduling`.
 */
import { format, parseISO } from "date-fns";
import { enCA, frCA } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { TIME_ZONE } from "@/lib/scheduling/time";
import { formatClockFr, type Weekday } from "@/lib/scheduling/weeklyBlocks";

import type { Locale } from "./config";

const MINUTES_PER_DAY = 1440;

/** Locale date-fns d'une langue de l'app. */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return locale === "en" ? enCA : frCA;
}

/**
 * Minutes depuis minuit → heure lisible : « 15 h 42 », « minuit » en français ;
 * « 3:42 PM », « midnight », « noon » en anglais.
 */
export function formatClockLocale(minutes: number, locale: Locale): string {
  if (locale === "fr") return formatClockFr(minutes);
  if (minutes === 0 || minutes === MINUTES_PER_DAY) return "midnight";
  if (minutes === 720) return "noon";
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Heure lisible d'un instant, dans le fuseau de l'app. */
export function formatInstantClock(instant: Date, locale: Locale, timeZone = TIME_ZONE): string {
  const [h, m] = formatInTimeZone(instant, timeZone, "HH:mm").split(":").map(Number);
  return formatClockLocale(h * 60 + m, locale);
}

/** Formats de date nommés (le motif date-fns change d'une langue à l'autre). */
export type DatePattern =
  | "weekdayDayMonth"
  | "weekdayDayMonthYear"
  | "dayMonth"
  | "dayMonthYear"
  | "shortWeekdayDayMonth"
  | "shortWeekdayDay"
  | "shortDayMonth"
  | "shortDayMonthYear"
  | "dayNumber"
  | "weekday"
  | "shortWeekday"
  | "monthYear";

const PATTERNS: Record<Locale, Record<DatePattern, string>> = {
  fr: {
    weekdayDayMonth: "EEEE d MMMM",
    weekdayDayMonthYear: "EEEE d MMMM yyyy",
    dayMonth: "d MMMM",
    dayMonthYear: "d MMMM yyyy",
    shortWeekdayDayMonth: "EEE d MMM",
    shortWeekdayDay: "EEE d",
    shortDayMonth: "d MMM",
    shortDayMonthYear: "d MMM yyyy",
    dayNumber: "d",
    weekday: "EEEE",
    shortWeekday: "EEE",
    monthYear: "MMMM yyyy",
  },
  en: {
    weekdayDayMonth: "EEEE, MMMM d",
    weekdayDayMonthYear: "EEEE, MMMM d, yyyy",
    dayMonth: "MMMM d",
    dayMonthYear: "MMMM d, yyyy",
    shortWeekdayDayMonth: "EEE, MMM d",
    shortWeekdayDay: "EEE d",
    shortDayMonth: "MMM d",
    shortDayMonthYear: "MMM d, yyyy",
    dayNumber: "d",
    weekday: "EEEE",
    shortWeekday: "EEE",
    monthYear: "MMMM yyyy",
  },
};

/** Motif date-fns d'un format nommé. */
export function datePattern(pattern: DatePattern, locale: Locale): string {
  return PATTERNS[locale][pattern];
}

/** Jour calendaire « yyyy-MM-dd » → texte (« mardi 4 mars » / « Tuesday, March 4 »). */
export function formatDay(day: string, pattern: DatePattern, locale: Locale): string {
  return format(parseISO(day), PATTERNS[locale][pattern], { locale: dateFnsLocale(locale) });
}

/** Instant → date en texte, dans le fuseau de l'app. */
export function formatInstantDay(
  instant: Date,
  pattern: DatePattern,
  locale: Locale,
  timeZone = TIME_ZONE,
): string {
  return formatInTimeZone(instant, timeZone, PATTERNS[locale][pattern], {
    locale: dateFnsLocale(locale),
  });
}

const WEEKDAY_NAMES: Record<
  Locale,
  { short: Record<Weekday, string>; long: Record<Weekday, string> }
> = {
  fr: {
    short: { 1: "lun.", 2: "mar.", 3: "mer.", 4: "jeu.", 5: "ven.", 6: "sam.", 7: "dim." },
    long: {
      1: "lundi",
      2: "mardi",
      3: "mercredi",
      4: "jeudi",
      5: "vendredi",
      6: "samedi",
      7: "dimanche",
    },
  },
  en: {
    short: { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" },
    long: {
      1: "Monday",
      2: "Tuesday",
      3: "Wednesday",
      4: "Thursday",
      5: "Friday",
      6: "Saturday",
      7: "Sunday",
    },
  },
};

/** Nom court d'un jour de la semaine ISO (« lun. » / « Mon »). */
export function weekdayShort(weekday: Weekday, locale: Locale): string {
  return WEEKDAY_NAMES[locale].short[weekday];
}

/** Nom long d'un jour de la semaine ISO (« lundi » / « Monday »). */
export function weekdayLong(weekday: Weekday, locale: Locale): string {
  return WEEKDAY_NAMES[locale].long[weekday];
}

/**
 * Durée en minutes → texte : « 1 h 30 », « 45 min » ; « 1 h 30 min », « 45 min » en anglais.
 */
export function formatDuration(minutes: number, locale: Locale): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return locale === "fr" ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h ${m} min`;
}
