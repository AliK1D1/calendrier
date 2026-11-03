/**
 * Horaire saisi à la main (page /horaire) : blocs hebdomadaires ou ponctuels décrits en
 * **heures locales** (minutes depuis minuit, fuseau America/Toronto) et en **jours**
 * (`yyyy-MM-dd`), comme dans la table `busy_blocks`. Fonctions pures, sans BD ni React.
 *
 * Pourquoi des heures locales et non des instants : un cours du lundi à 10 h reste à 10 h
 * après le changement d'heure. La conversion en instants absolus (pour la recherche de
 * rencontres) se fait dans `src/lib/db/convert.ts` (`expandBusyBlocks`, via `zonedTime`).
 */
import { addDays, format, getISODay, parseISO } from "date-fns";

import { cleanText } from "@/lib/places/validation";

import { assertDay } from "./time";
import type { DateRange, PlaceId } from "./types";

/** Minutes dans une journée « normale » (borne de fin : 24:00). */
export const MINUTES_PER_DAY = 24 * 60;

/** Pas de la grille de saisie, en minutes. */
export const GRID_STEP_MINUTES = 15;

/** Longueur maximale d'un titre de bloc. */
export const BLOCK_TITLE_MAX = 100;

/** Durée maximale d'une période de validité (session) d'un bloc hebdomadaire, en jours. */
export const MAX_SESSION_DAYS = 366;

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Noms courts et longs des jours (français), indexés par `Weekday`. */
export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: "lun.",
  2: "mar.",
  3: "mer.",
  4: "jeu.",
  5: "ven.",
  6: "sam.",
  7: "dim.",
};
export const WEEKDAY_LONG: Record<Weekday, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  7: "dimanche",
};

/**
 * Un bloc de l'horaire, tel que saisi.
 * - Hebdomadaire : `weekday` non nul ; il a lieu ce jour-là chaque semaine, du `validFrom` au
 *   `validUntil` inclus (une borne nulle = pas de limite de ce côté).
 * - Ponctuel : `weekday` nul ; il a lieu le jour `validFrom` seulement.
 */
export interface BlockSpec {
  /** Identifiant (absent pour un bloc pas encore enregistré). */
  id?: string;
  title: string;
  /** Lieu du bloc ; nul = la maison. */
  placeId: PlaceId | null;
  /** Début, en minutes depuis minuit (heure locale). */
  startMinute: number;
  /** Fin, en minutes depuis minuit (heure locale, exclusive, au plus 24:00). */
  endMinute: number;
  weekday: Weekday | null;
  validFrom: string | null;
  validUntil: string | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CLOCK_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** « HH:mm » (00:00 à 24:00) → minutes depuis minuit ; `null` si invalide. */
export function parseClock(raw: string): number | null {
  const m = CLOCK_RE.exec(raw);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= MINUTES_PER_DAY ? minutes : null;
}

/** Minutes depuis minuit → « HH:mm » (1440 → « 24:00 »). */
export function formatClock(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new Error(`Minutes invalides : ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes depuis minuit → heure à la québécoise : « 9 h », « 10 h 15 », « minuit ». */
export function formatClockFr(minutes: number): string {
  if (minutes === 0 || minutes === MINUTES_PER_DAY) return "minuit";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Jour de la semaine ISO d'un jour `yyyy-MM-dd`. */
export function weekdayOf(day: string): Weekday {
  assertDay(day);
  return getISODay(parseISO(day)) as Weekday;
}

/** Ajoute `n` jours calendaires à un jour (indépendant du fuseau et de l'heure avancée). */
export function shiftDay(day: string, n: number): string {
  assertDay(day);
  return format(addDays(parseISO(day), n), "yyyy-MM-dd");
}

/** Nombre de jours calendaires de `from` à `to` (négatif si `to` est avant). */
export function daysBetween(from: string, to: string): number {
  assertDay(from);
  assertDay(to);
  const [a, b] = [from, to].map((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  });
  return Math.round((b - a) / 86_400_000);
}

/** Lundi de la semaine qui contient `day`. */
export function weekStart(day: string): string {
  return shiftDay(day, 1 - weekdayOf(day));
}

/** Les 7 jours (lundi → dimanche) de la semaine qui commence le lundi `monday`. */
export function weekDays(monday: string): string[] {
  if (weekdayOf(monday) !== 1) throw new Error(`Pas un lundi : ${monday}`);
  return WEEKDAYS.map((_, i) => shiftDay(monday, i));
}

/** Vrai si le bloc a lieu le jour `day`. Un bloc hebdomadaire s'arrête après `validUntil`. */
export function occursOn(block: BlockSpec, day: string): boolean {
  if (block.weekday == null) return block.validFrom === day;
  if (weekdayOf(day) !== block.weekday) return false;
  if (block.validFrom && day < block.validFrom) return false;
  if (block.validUntil && day > block.validUntil) return false;
  return true;
}

/** Blocs qui ont lieu le jour `day`, triés par heure de début puis de fin. */
export function blocksOnDay<T extends BlockSpec>(blocks: readonly T[], day: string): T[] {
  return blocks
    .filter((b) => occursOn(b, day))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

/** Les jours (`yyyy-MM-dd`) où un bloc a lieu, sur une plage incluse. */
export function occurrencesIn(block: BlockSpec, range: DateRange): string[] {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = shiftDay(d, 1)) {
    if (occursOn(block, d)) days.push(d);
  }
  return days;
}

/**
 * Vrai si deux blocs ont lieu au moins une fois le même jour (les heures ne comptent pas) :
 * même jour de semaine et sessions qui se croisent sur ce jour-là, ou ponctuel qui tombe
 * pendant un hebdomadaire, ou deux ponctuels le même jour.
 */
export function shareADay(a: BlockSpec, b: BlockSpec): boolean {
  if (a.weekday == null || b.weekday == null) {
    const [once, other] = a.weekday == null ? [a, b] : [b, a];
    return once.validFrom != null && occursOn(other, once.validFrom);
  }
  if (a.weekday !== b.weekday) return false;
  const from = maxDay(a.validFrom, b.validFrom);
  const until = minDay(a.validUntil, b.validUntil);
  // Un côté sans borne : la période commune contient forcément ce jour de semaine.
  if (from == null || until == null) return true;
  const first = shiftDay(from, (a.weekday - weekdayOf(from) + 7) % 7);
  return first <= until;
}

/** Vrai si deux blocs se chevauchent au moins une fois (même jour, heures qui se croisent). */
export function blocksOverlap(a: BlockSpec, b: BlockSpec): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute && shareADay(a, b);
}

/**
 * Blocs existants qui chevauchent `candidate` (en ignorant le bloc `candidate.id` lui-même,
 * pour une modification). Les blocs collés (fin = début) ne se chevauchent pas.
 */
export function findOverlaps<T extends BlockSpec>(
  candidate: BlockSpec,
  existing: readonly T[],
): T[] {
  return existing.filter(
    (b) => (candidate.id === undefined || b.id !== candidate.id) && blocksOverlap(candidate, b),
  );
}

/**
 * Session proposée par défaut pour un nouveau bloc hebdomadaire :
 * 1. la période la plus fréquente parmi mes blocs hebdomadaires encore en cours ou à venir
 *    (on entre en général tous les cours d'une même session) ;
 * 2. sinon, la session de cégep qui contient `today` ou la prochaine : automne (fin août →
 *    20 déc.), hiver (20 janv. → 20 mai), été (21 mai → 20 août). À ajuster dans le formulaire.
 *
 * Le début proposé ne tombe jamais après le lundi de la semaine en cours : l'horaire s'ouvre
 * sur cette semaine, et un cours du lundi saisi un mardi doit y paraître dès ce lundi-là
 * (sinon son « premier lundi » manque). Un début déjà placé plus tard dans la semaine en cours
 * (bloc saisi avant ce correctif) est aussi ramené au lundi.
 */
export function suggestSession(blocks: readonly BlockSpec[], today: string): DateRange {
  assertDay(today);
  const counts = new Map<string, { range: DateRange; n: number }>();
  for (const b of blocks) {
    if (b.weekday == null || !b.validFrom || !b.validUntil || b.validUntil < today) continue;
    const key = `${b.validFrom}/${b.validUntil}`;
    const entry = counts.get(key) ?? { range: { from: b.validFrom, to: b.validUntil }, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  const best = [...counts.values()].sort(
    (x, y) => y.n - x.n || x.range.from.localeCompare(y.range.from),
  )[0];
  if (best) return { from: notAfterThisMonday(best.range.from, today), to: best.range.to };

  const year = Number(today.slice(0, 4));
  const sessions: DateRange[] = [
    { from: `${year}-01-20`, to: `${year}-05-20` },
    { from: `${year}-05-21`, to: `${year}-08-20` },
    { from: `${year}-08-21`, to: `${year}-12-20` },
    { from: `${year + 1}-01-20`, to: `${year + 1}-05-20` },
  ];
  const current = sessions.find((s) => today <= s.to) ?? sessions[3];
  // Pendant la session : à partir du lundi de cette semaine (inutile de remonter plus loin).
  const thisMonday = weekStart(today);
  return { from: thisMonday > current.from ? thisMonday : current.from, to: current.to };
}

/**
 * `from` s'il tombe avant la semaine de `today` ou après elle ; sinon (un jour de la semaine
 * en cours) le lundi de cette semaine.
 */
function notAfterThisMonday(from: string, today: string): string {
  const thisMonday = weekStart(today);
  return weekStart(from) === thisMonday ? thisMonday : from;
}

// ─── Validation des données envoyées par le navigateur ──────────────────────────────────────

/** Données brutes du formulaire « bloc ». */
export interface BlockFormInput {
  title: string;
  placeId: string | null;
  /** « HH:mm » */
  start: string;
  /** « HH:mm » */
  end: string;
  kind: "weekly" | "once";
  /** Jours cochés (hebdomadaire). */
  weekdays: number[];
  /** Jour (ponctuel), `yyyy-MM-dd`. */
  date: string;
  /** Début et fin de session (hebdomadaire), `yyyy-MM-dd`. */
  sessionStart: string;
  sessionEnd: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

function isDay(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    assertDay(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valide un bloc envoyé par le formulaire et le transforme en `BlockSpec` (un par jour coché
 * pour un bloc hebdomadaire). Règles :
 * - titre : 1 à 100 caractères après nettoyage ;
 * - lieu : uuid ou nul (maison) ; la RLS vérifie ensuite que c'est un de mes lieux ;
 * - heures « HH:mm », début < fin, au plus 24:00 (un bloc ne traverse pas minuit) ;
 * - hebdomadaire : au moins un jour, session avec début ≤ fin et au plus 366 jours ;
 * - ponctuel : un jour valide.
 * `single` : un seul jour permis (modification d'un bloc existant).
 */
export function validateBlockForm(
  raw: unknown,
  options: { single?: boolean } = {},
): ValidationResult<BlockSpec[]> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Bloc invalide." };
  const r = raw as Record<string, unknown>;

  if (typeof r.title !== "string") return { ok: false, error: "Le titre est manquant." };
  if (CONTROL_CHARS.test(r.title.replace(/[\t\n\r]/g, " "))) {
    return { ok: false, error: "Le titre contient des caractères invalides." };
  }
  const title = cleanText(r.title);
  if (!title) return { ok: false, error: "Donne un titre au bloc (ex. « Chimie »)." };
  if (title.length > BLOCK_TITLE_MAX) {
    return {
      ok: false,
      error: `Le titre est trop long (${BLOCK_TITLE_MAX} caractères au maximum).`,
    };
  }

  let placeId: string | null = null;
  if (r.placeId != null && r.placeId !== "") {
    if (typeof r.placeId !== "string" || !UUID.test(r.placeId)) {
      return { ok: false, error: "Lieu introuvable." };
    }
    placeId = r.placeId.toLowerCase();
  }

  const start = typeof r.start === "string" ? parseClock(r.start) : null;
  const end = typeof r.end === "string" ? parseClock(r.end) : null;
  if (start === null || end === null) return { ok: false, error: "Heure invalide." };
  if (start >= MINUTES_PER_DAY) return { ok: false, error: "Heure de début invalide." };
  if (end <= start) return { ok: false, error: "La fin doit être après le début." };

  const base = { title, placeId, startMinute: start, endMinute: end };

  if (r.kind === "once") {
    if (!isDay(r.date)) return { ok: false, error: "Choisis le jour du bloc." };
    return {
      ok: true,
      value: [{ ...base, weekday: null, validFrom: r.date, validUntil: r.date }],
    };
  }
  if (r.kind !== "weekly") return { ok: false, error: "Type de bloc invalide." };

  if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) {
    return { ok: false, error: "Coche au moins un jour de la semaine." };
  }
  const days = new Set<Weekday>();
  for (const d of r.weekdays) {
    if (typeof d !== "number" || !(WEEKDAYS as readonly number[]).includes(d)) {
      return { ok: false, error: "Jour de la semaine invalide." };
    }
    days.add(d as Weekday);
  }
  if (options.single && days.size !== 1) {
    return { ok: false, error: "Un bloc modifié a un seul jour de la semaine." };
  }
  if (!isDay(r.sessionStart) || !isDay(r.sessionEnd)) {
    return { ok: false, error: "Indique le début et la fin de la session." };
  }
  if (r.sessionEnd < r.sessionStart) {
    return { ok: false, error: "La fin de la session doit être après son début." };
  }
  if (daysBetween(r.sessionStart, r.sessionEnd) >= MAX_SESSION_DAYS) {
    return { ok: false, error: "La session dure plus d'un an : vérifie les dates." };
  }
  const { sessionStart, sessionEnd } = r;
  const blocks = [...days]
    .sort((a, b) => a - b)
    .map((weekday) => ({ ...base, weekday, validFrom: sessionStart, validUntil: sessionEnd }));
  if (!blocks.some((b) => occurrencesIn(b, { from: sessionStart, to: sessionEnd }).length > 0)) {
    return { ok: false, error: "Aucun de ces jours ne tombe dans la session." };
  }
  return { ok: true, value: blocks };
}

/** Identifiant de bloc (uuid). */
export function validateBlockId(raw: unknown): ValidationResult<string> {
  return typeof raw === "string" && UUID.test(raw)
    ? { ok: true, value: raw.toLowerCase() }
    : { ok: false, error: "Bloc introuvable." };
}

// ─── Outils internes ────────────────────────────────────────────────────────────────────────

function maxDay(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

function minDay(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}
