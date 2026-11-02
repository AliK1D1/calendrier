import { addDays, format, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

/** Fuseau horaire de l'app. */
export const TIME_ZONE = "America/Toronto";

/** Nombre de millisecondes dans une minute. */
export const MS_PER_MINUTE = 60_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

function assertDay(day: string): void {
  if (!DAY_RE.test(day)) throw new Error(`Jour invalide (attendu yyyy-MM-dd) : ${day}`);
}

/**
 * Instant correspondant à l'heure locale `time` (« HH:mm ») du jour `day` (« yyyy-MM-dd »)
 * dans le fuseau donné. « 24:00 » désigne minuit le jour suivant. Gère l'heure avancée.
 */
export function zonedTime(day: string, time: string, timeZone: string = TIME_ZONE): Date {
  assertDay(day);
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Heure invalide (attendu HH:mm) : ${time}`);
  if (m[1] === "24") {
    if (m[2] !== "00") throw new Error(`Heure invalide : ${time}`);
    return fromZonedTime(`${nextDay(day)}T00:00:00`, timeZone);
  }
  return fromZonedTime(`${day}T${time}:00`, timeZone);
}

/** Début (minuit local) et fin (minuit local suivant) d'un jour : 23, 24 ou 25 h. */
export function zonedDayBounds(
  day: string,
  timeZone: string = TIME_ZONE,
): { start: Date; end: Date } {
  return { start: zonedTime(day, "00:00", timeZone), end: zonedTime(day, "24:00", timeZone) };
}

/** Jour calendaire suivant (« yyyy-MM-dd »), indépendant du fuseau. */
export function nextDay(day: string): string {
  assertDay(day);
  return format(addDays(parseISO(day), 1), "yyyy-MM-dd");
}

/** Tous les jours de `from` à `to` inclus (« yyyy-MM-dd »). */
export function eachDay(from: string, to: string): string[] {
  assertDay(from);
  assertDay(to);
  const days: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) days.push(d);
  return days;
}

/** Ajoute des minutes à un instant (durée réelle, insensible à l'heure avancée). */
export function addMinutesTo(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

/** Durée en minutes entre deux instants. */
export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / MS_PER_MINUTE;
}
