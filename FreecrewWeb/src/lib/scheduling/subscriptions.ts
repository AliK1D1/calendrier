/**
 * Calendriers abonnés (story 3) : fenêtre lue, fréquence de synchro et conversion des
 * événements lus (fichier iCalendar ou Outlook) en lignes `subscription_events`. Fonctions
 * pures : aucun accès réseau ni BD.
 *
 * Comme pour Outlook, on lit de la semaine en cours (lundi) à 8 semaines plus tard. Les
 * heures sont des heures d'horloge locales (America/Toronto) et un bloc ne traverse pas minuit.
 */
import { formatInTimeZone } from "date-fns-tz";

import type { DayBusyPiece, DayRange } from "./outlookBusy";
import { TIME_ZONE } from "./time";
import { formatClock, shiftDay, type Weekday, weekStart } from "./weeklyBlocks";

/** Semaines lues à partir de la semaine en cours. */
export const SUBSCRIPTION_WEEKS = 8;
/** Synchro automatique (quand l'app est ouverte) : au plus aux 6 heures. */
export const SUBSCRIPTION_AUTO_SYNC_MINUTES = 6 * 60;
/** Bouton « Actualiser » : au plus aux 2 minutes. */
export const SUBSCRIPTION_MANUAL_SYNC_MINUTES = 2;
/** Événements gardés par calendrier (la BD refuse au-delà). */
export const SUBSCRIPTION_MAX_EVENTS = 300;
/** Calendriers abonnés par personne (la BD refuse au-delà). */
export const SUBSCRIPTION_MAX_PER_USER = 10;
/** Longueur maximale du nom d'un calendrier abonné. */
export const SUBSCRIPTION_NAME_MAX = 100;

/** Ligne envoyée à `replace_subscription_events`. */
export interface SubscriptionEventRow {
  title: string;
  start: string;
  end: string;
  /** Jour de semaine (1 = lundi) d'un événement qui revient chaque semaine, sinon nul. */
  weekday: Weekday | null;
  /** Jour (ponctuel) ou premier jour (hebdomadaire). */
  from: string;
  /** Dernier jour (hebdomadaire) ; nul pour un événement ponctuel. */
  until: string | null;
}

/** Jours lus à l'instant `now` : du lundi de la semaine en cours à la fin de la 8e semaine. */
export function subscriptionRange(now: Date, timeZone: string = TIME_ZONE): DayRange {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const from = weekStart(today);
  return { from, to: shiftDay(from, SUBSCRIPTION_WEEKS * 7 - 1) };
}

/** Bloc lu dans un fichier iCalendar (sous-ensemble de `ImportedBlock`). */
export interface IcsBlockLike {
  title: string;
  startMinute: number;
  endMinute: number;
  weekday: Weekday | null;
  validFrom: string;
  validUntil: string;
}

/**
 * Blocs lus dans un fichier iCalendar → lignes, limitées à `range`, triées. Un bloc
 * hebdomadaire qui ne revient qu'une fois dans la fenêtre reste hebdomadaire (même sens).
 */
export function icsBlocksToRows(
  blocks: readonly IcsBlockLike[],
  range: DayRange,
): SubscriptionEventRow[] {
  const rows: SubscriptionEventRow[] = [];
  for (const b of blocks) {
    if (b.validUntil < range.from || b.validFrom > range.to) continue;
    if (!(b.endMinute > b.startMinute)) continue;
    const weekly = b.weekday !== null;
    rows.push({
      title: cleanName(b.title, ""),
      start: formatClock(b.startMinute),
      end: formatClock(b.endMinute),
      weekday: b.weekday,
      from: b.validFrom,
      until: weekly ? b.validUntil : null,
    });
  }
  return rows.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.start.localeCompare(b.start) ||
      a.title.localeCompare(b.title),
  );
}

/** Morceaux lus dans Outlook (déjà par jour local) → lignes ponctuelles au nom du calendrier. */
export function piecesToRows(
  pieces: readonly DayBusyPiece[],
  title: string,
): SubscriptionEventRow[] {
  const name = cleanName(title, "");
  return pieces.map((p) => ({
    title: name,
    start: formatClock(p.startMinute),
    end: formatClock(p.endMinute),
    weekday: null,
    from: p.day,
    until: null,
  }));
}

/** Nom propre (une ligne, sans caractères de contrôle, 100 caractères au plus) ou `fallback`. */
export function cleanName(raw: string, fallback: string): string {
  const text = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > SUBSCRIPTION_NAME_MAX
    ? `${text.slice(0, SUBSCRIPTION_NAME_MAX - 1).trimEnd()}…`
    : text;
}

/**
 * Nom du calendrier écrit dans le fichier (`X-WR-CALNAME`, utilisé par Google, Apple, Outlook
 * et la plupart des calendriers publics), ou « ».
 */
export function icsCalendarName(text: string): string {
  const m = /^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*(?:\r?\n[ \t].*)*)/im.exec(text.slice(0, 20_000));
  if (!m) return "";
  const unfolded = m[1].replace(/\r?\n[ \t]/g, "");
  const unescaped = unfolded.replace(/\\([,;\\nN])/g, (_, c: string) =>
    c === "n" || c === "N" ? " " : c,
  );
  return cleanName(unescaped, "");
}
