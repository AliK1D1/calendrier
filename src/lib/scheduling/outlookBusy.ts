/**
 * Calendrier Outlook (connecteur) : transforme les événements lus dans Outlook en morceaux
 * occupés **par jour local** (fuseau America/Toronto), prêts à devenir des blocs ponctuels
 * `busy_blocks` (`source = 'outlook'`). Fonctions pures : aucun accès réseau ni BD.
 *
 * Règles :
 * - un événement annulé, ou marqué « Disponible » (`showAs = free`) dans Outlook, ne compte
 *   pas ; tout le reste (occupé, provisoire, absent, ailleurs, inconnu) compte comme occupé ;
 * - un bloc ne traverse pas minuit : un événement de 22 h à 1 h donne deux morceaux ;
 * - les heures sont des heures **d'horloge** locales (comme les autres blocs) : un jour de
 *   changement d'heure dure 23 ou 25 h, on ne suppose jamais 24 h ;
 * - on arrondit vers l'extérieur à la minute (on ne raccourcit jamais un engagement) ;
 * - les morceaux qui se chevauchent ou se touchent le même jour sont fusionnés.
 */
import { formatInTimeZone } from "date-fns-tz";

import { eachDay, minutesBetween, nextDay, TIME_ZONE, zonedDayBounds } from "./time";
import { MINUTES_PER_DAY, shiftDay, weekStart } from "./weeklyBlocks";

/** Valeurs de `showAs` de Microsoft Graph. Toute autre valeur compte comme occupée. */
export type OutlookShowAs = "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";

/** Événement Outlook, réduit à ce qui sert à savoir quand la personne est occupée. */
export type ExternalBusyEvent =
  | {
      kind: "timed";
      start: Date;
      end: Date;
    }
  | {
      /** Événement « toute la journée » : jours locaux `firstDay` à `lastDay` inclus. */
      kind: "allDay";
      firstDay: string;
      lastDay: string;
    };

/** Morceau occupé d'un jour local (minutes d'horloge, fin exclusive, au plus 24:00). */
export interface DayBusyPiece {
  day: string;
  startMinute: number;
  endMinute: number;
}

/** Jours locaux inclus lus dans Outlook. */
export interface DayRange {
  from: string;
  to: string;
}

/** Semaines lues dans Outlook à partir de la semaine en cours (8 semaines en tout). */
export const OUTLOOK_SYNC_WEEKS = 8;

/** Nombre maximal de blocs Outlook gardés (la BD refuse au-delà de 1000 blocs par personne). */
export const OUTLOOK_MAX_BLOCKS = 500;

/** Synchronisation automatique : au plus une fois par 15 min. */
export const OUTLOOK_AUTO_SYNC_MINUTES = 15;

/** Bouton « Actualiser » : au plus une fois par minute (limite d'appels à Microsoft). */
export const OUTLOOK_MANUAL_SYNC_MINUTES = 1;

/** Vrai si l'événement compte comme du temps occupé. */
export function countsAsBusy(showAs: string | null | undefined, isCancelled: boolean): boolean {
  if (isCancelled) return false;
  return showAs !== "free";
}

/**
 * Jours lus dans Outlook à l'instant `now` : du lundi de la semaine en cours (pour que la
 * semaine affichée dans « Mon horaire » soit complète) jusqu'à la fin de la 8e semaine.
 */
export function outlookSyncRange(now: Date, timeZone: string = TIME_ZONE): DayRange {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const from = weekStart(today);
  return { from, to: shiftDay(from, OUTLOOK_SYNC_WEEKS * 7 - 1) };
}

/** Instants (UTC) qui couvrent les jours `range` : début et fin à demander à Outlook. */
export function rangeInstants(
  range: DayRange,
  timeZone: string = TIME_ZONE,
): { start: Date; end: Date } {
  return {
    start: zonedDayBounds(range.from, timeZone).start,
    end: zonedDayBounds(range.to, timeZone).end,
  };
}

/**
 * Vrai s'il est temps de resynchroniser : jamais essayé, ou dernier essai il y a au moins
 * `intervalMinutes`. Une date invalide compte comme « jamais ».
 */
export function isSyncDue(
  lastAttemptAt: string | null,
  now: Date,
  intervalMinutes: number,
): boolean {
  if (!lastAttemptAt) return true;
  const last = new Date(lastAttemptAt);
  if (Number.isNaN(last.getTime())) return true;
  return minutesBetween(last, now) >= intervalMinutes;
}

/** Minutes d'horloge locale de l'instant `d` (secondes ignorées). */
function clockMinutes(d: Date, timeZone: string): number {
  const [h, m] = formatInTimeZone(d, timeZone, "HH:mm").split(":").map(Number);
  return h * 60 + m;
}

function hasSeconds(d: Date): boolean {
  return d.getTime() % 60_000 !== 0;
}

const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);

/** Morceaux d'un événement à heures précises, jour par jour, limités à `range`. */
function timedPieces(start: Date, end: Date, range: DayRange, timeZone: string): DayBusyPiece[] {
  if (!(end.getTime() > start.getTime())) return [];
  const firstDay = maxDay(formatInTimeZone(start, timeZone, "yyyy-MM-dd"), range.from);
  // Le dernier jour touché : celui de la dernière milliseconde de l'événement.
  const lastDay = minDay(
    formatInTimeZone(new Date(end.getTime() - 1), timeZone, "yyyy-MM-dd"),
    range.to,
  );
  if (firstDay > lastDay) return [];
  const pieces: DayBusyPiece[] = [];
  for (const day of eachDay(firstDay, lastDay)) {
    const bounds = zonedDayBounds(day, timeZone);
    const s = start > bounds.start ? start : bounds.start;
    const e = end < bounds.end ? end : bounds.end;
    if (!(e.getTime() > s.getTime())) continue;
    const startMinute = s.getTime() === bounds.start.getTime() ? 0 : clockMinutes(s, timeZone);
    let endMinute: number;
    if (e.getTime() === bounds.end.getTime()) endMinute = MINUTES_PER_DAY;
    else endMinute = Math.min(MINUTES_PER_DAY, clockMinutes(e, timeZone) + (hasSeconds(e) ? 1 : 0));
    // Retour à l'heure normale (1 h à 2 h existe deux fois) : l'heure d'horloge de fin peut
    // tomber avant celle du début. On garde alors la vraie durée à partir du début.
    if (endMinute <= startMinute) {
      endMinute = Math.min(MINUTES_PER_DAY, startMinute + Math.ceil(minutesBetween(s, e)));
    }
    if (endMinute > startMinute) pieces.push({ day, startMinute, endMinute });
  }
  return pieces;
}

/** Morceaux d'un événement « toute la journée » (jours entiers), limités à `range`. */
function allDayPieces(firstDay: string, lastDay: string, range: DayRange): DayBusyPiece[] {
  const from = maxDay(firstDay, range.from);
  const to = minDay(lastDay, range.to);
  if (from > to) return [];
  return eachDay(from, to).map((day) => ({ day, startMinute: 0, endMinute: MINUTES_PER_DAY }));
}

/** Fusionne les morceaux qui se chevauchent ou se touchent, par jour ; triés. */
export function mergeDayPieces(pieces: readonly DayBusyPiece[]): DayBusyPiece[] {
  const sorted = [...pieces].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  const out: DayBusyPiece[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.day === p.day && p.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, p.endMinute);
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/**
 * Événements Outlook → morceaux occupés par jour local, dans `range`, fusionnés et triés.
 * `truncated` : vrai si on a dû s'arrêter à `maxBlocks` (on garde les plus proches).
 */
export function outlookEventsToDayPieces(
  events: readonly ExternalBusyEvent[],
  range: DayRange,
  options: { timeZone?: string; maxBlocks?: number } = {},
): { pieces: DayBusyPiece[]; truncated: boolean } {
  const timeZone = options.timeZone ?? TIME_ZONE;
  const maxBlocks = options.maxBlocks ?? OUTLOOK_MAX_BLOCKS;
  const raw: DayBusyPiece[] = [];
  for (const ev of events) {
    if (ev.kind === "timed") raw.push(...timedPieces(ev.start, ev.end, range, timeZone));
    else raw.push(...allDayPieces(ev.firstDay, ev.lastDay, range));
  }
  const merged = mergeDayPieces(raw);
  return merged.length > maxBlocks
    ? { pieces: merged.slice(0, maxBlocks), truncated: true }
    : { pieces: merged, truncated: false };
}

/**
 * Jours d'un événement « toute la journée » de Microsoft Graph : `start` et `end` sont des
 * minuits (la fin est exclusive). « 2026-11-04T00:00:00 » → « 2026-11-05T00:00:00 » donne le
 * seul jour 2026-11-04. `null` si les dates sont illisibles ou à l'envers.
 */
export function allDayRange(startDateTime: string, endDateTime: string): DayRange | null {
  const DAY = /^(\d{4}-\d{2}-\d{2})/;
  const s = DAY.exec(startDateTime)?.[1];
  const e = DAY.exec(endDateTime)?.[1];
  if (!s || !e) return null;
  try {
    // Valide les deux jours (lève une erreur pour « 2026-02-30 »).
    nextDay(s);
    nextDay(e);
  } catch {
    return null;
  }
  if (e <= s) return { from: s, to: s };
  return { from: s, to: shiftDay(e, -1) };
}
