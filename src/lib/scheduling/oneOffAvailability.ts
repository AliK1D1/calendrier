/**
 * Disponibilités ponctuelles (segment 18) : « ce samedi, je suis libre de 13 h à 18 h ».
 * Fonctions pures, sans BD ni React.
 *
 * Règle (le modèle de l'app ne connaît que des blocs occupés ; une disponibilité dit plus) :
 * - **ce jour-là, la personne n'est disponible que pendant ses disponibilités** : le reste de
 *   la journée locale devient occupé, à la maison (comme les heures « je ne sors pas ») ;
 * - **pendant ses disponibilités, ses blocs récurrents sont levés** : cours et travail
 *   hebdomadaires, heures « je ne sors pas » (ex. le shift du samedi est annulé cette fois-ci) ;
 * - ses blocs **ponctuels** (plan accepté, séance d'étude, rendez-vous de ce jour-là) restent
 *   occupés : ils sont propres à ce jour-là, donc plus précis que la disponibilité.
 * Les jours sans disponibilité ne changent pas.
 */
import { TIME_ZONE, zonedDayBounds, zonedTime } from "./time";
import type { BusyBlock, PlaceId } from "./types";
import { formatClockFr, MINUTES_PER_DAY, parseClock, type ValidationResult } from "./weeklyBlocks";

/** Une disponibilité : un jour local et des heures locales (« 24:00 » = minuit suivant). */
export interface OneOffAvailability {
  id: string;
  /** Jour local, « yyyy-MM-dd ». */
  day: string;
  /** « HH:mm » */
  start: string;
  /** « HH:mm » (« 24:00 » permis). */
  end: string;
}

/** Durée minimale d'une disponibilité, en minutes (même règle que la BD). */
export const MIN_AVAILABILITY_MINUTES = 15;
/** Longueur maximale de la note (même règle que la BD). */
export const MAX_AVAILABILITY_NOTE = 60;
/** Nombre maximal de disponibilités par personne (même règle que la BD). */
export const MAX_AVAILABILITIES = 100;
/** Titre des blocs « pas disponible » ajoutés autour des disponibilités. */
export const UNAVAILABLE_TITLE = "Pas disponible";

interface Interval {
  start: Date;
  end: Date;
}

/** Trie et fusionne des intervalles (ceux qui se chevauchent ou se touchent). */
function union(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end.getTime() > last.end.getTime()) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/** `block` moins les intervalles `holes` (triés, disjoints) : 0, 1 ou plusieurs morceaux. */
function subtract(block: BusyBlock, holes: Interval[]): BusyBlock[] {
  const pieces: BusyBlock[] = [];
  let cursor = block.start.getTime();
  const end = block.end.getTime();
  for (const h of holes) {
    if (h.end.getTime() <= cursor || h.start.getTime() >= end) continue;
    if (h.start.getTime() > cursor) {
      pieces.push({ ...block, start: new Date(cursor), end: h.start });
    }
    cursor = Math.max(cursor, h.end.getTime());
  }
  if (cursor < end) pieces.push({ ...block, start: new Date(cursor), end: block.end });
  if (pieces.length === 1 && pieces[0].start === block.start && pieces[0].end === block.end) {
    return [block];
  }
  return pieces.map((p, i) => (pieces.length === 1 ? p : { ...p, id: `${block.id}#${i + 1}` }));
}

/** Instants d'une disponibilité ; `null` si elle est vide (ex. dans l'heure sautée en mars). */
export function availabilityInterval(
  a: OneOffAvailability,
  timeZone: string = TIME_ZONE,
): Interval | null {
  const start = zonedTime(a.day, a.start, timeZone);
  const end = zonedTime(a.day, a.end, timeZone);
  return end.getTime() > start.getTime() ? { start, end } : null;
}

/**
 * Applique les disponibilités ponctuelles d'une personne à ses blocs (règle en tête de
 * fichier). `recurring` : blocs levés pendant une disponibilité (hebdomadaires dépliés,
 * heures « je ne sors pas ») ; `fixed` : blocs gardés tels quels (ponctuels). Renvoie tous
 * les blocs occupés, triés par début. Identifiants des blocs ajoutés :
 * `indispo@<jour>#<n>` ; un bloc coupé en deux : `<id>#1`, `<id>#2`.
 */
export function applyOneOffAvailability(
  recurring: readonly BusyBlock[],
  fixed: readonly BusyBlock[],
  availabilities: readonly OneOffAvailability[],
  homePlaceId: PlaceId,
  timeZone: string = TIME_ZONE,
): BusyBlock[] {
  const byDay = new Map<string, Interval[]>();
  for (const a of availabilities) {
    const interval = availabilityInterval(a, timeZone);
    if (!interval) continue;
    byDay.set(a.day, [...(byDay.get(a.day) ?? []), interval]);
  }

  const holes: Interval[] = [];
  const unavailable: BusyBlock[] = [];
  for (const [day, intervals] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const free = union(intervals);
    holes.push(...free);
    const bounds = zonedDayBounds(day, timeZone);
    let cursor = bounds.start;
    let n = 0;
    const push = (start: Date, end: Date) => {
      if (end.getTime() <= start.getTime()) return;
      n++;
      unavailable.push({
        id: `indispo@${day}#${n}`,
        start,
        end,
        placeId: homePlaceId,
        title: UNAVAILABLE_TITLE,
      });
    };
    for (const f of free) {
      push(cursor, f.start);
      cursor = f.end;
    }
    push(cursor, bounds.end);
  }

  const lifted = union(holes);
  return [...recurring.flatMap((b) => subtract(b, lifted)), ...fixed, ...unavailable].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
  );
}

/** Disponibilité validée (formulaire). */
export interface AvailabilityForm {
  day: string;
  /** Minutes depuis minuit. */
  startMinute: number;
  /** Minutes depuis minuit (1440 = minuit suivant). */
  endMinute: number;
  note: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// Mêmes caractères interdits que la BD (contrainte availability_slots_note_chars).
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Valide le formulaire `{ day, start, end, note? }` : jour entre `today` (« yyyy-MM-dd ») et
 * un an plus tard, « de » avant « à » d'au moins 15 min, note d'une ligne de 60 caractères au
 * plus. Mêmes règles que la BD.
 */
export function validateAvailabilityForm(
  raw: unknown,
  today: string,
  lastDay: string,
): ValidationResult<AvailabilityForm> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Formulaire invalide." };
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== "string" || !DAY_RE.test(r.day)) {
    return { ok: false, error: "Choisis un jour." };
  }
  try {
    zonedDayBounds(r.day);
  } catch {
    return { ok: false, error: "Jour invalide." };
  }
  if (r.day < today || r.day > lastDay) {
    return { ok: false, error: "Le jour doit être entre aujourd'hui et dans un an." };
  }
  const start = typeof r.start === "string" ? parseClock(r.start) : null;
  const end = typeof r.end === "string" ? parseClock(r.end) : null;
  if (start === null || end === null || start < 0 || end > MINUTES_PER_DAY) {
    return { ok: false, error: "Heure invalide." };
  }
  if (end - start < MIN_AVAILABILITY_MINUTES) {
    return {
      ok: false,
      error: `L'heure de fin doit être au moins ${MIN_AVAILABILITY_MINUTES} min après le début.`,
    };
  }
  const note = r.note == null ? "" : r.note;
  if (typeof note !== "string") return { ok: false, error: "Note invalide." };
  const trimmed = note.trim();
  if (trimmed.length > MAX_AVAILABILITY_NOTE) {
    return { ok: false, error: `La note fait au plus ${MAX_AVAILABILITY_NOTE} caractères.` };
  }
  if (CONTROL_CHARS.test(trimmed)) {
    return { ok: false, error: "La note contient des caractères non permis." };
  }
  return { ok: true, value: { day: r.day, startMinute: start, endMinute: end, note: trimmed } };
}

/** « 13 h – 18 h » */
export function availabilityLabel(startMinute: number, endMinute: number): string {
  return `${formatClockFr(startMinute)} – ${formatClockFr(endMinute)}`;
}
