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

import {
  describeEvery,
  describeRepeat,
  isValidEvery,
  nthOccurrence,
  recursOn,
  REPEAT_COUNT_MAX,
  REPEAT_EVERY_MAX,
  REPEAT_UNITS,
  type RepeatUnit,
} from "./recurrence";
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

/**
 * Durée maximale d'une répétition personnalisée qui a une date de fin, en jours (10 ans). Sans
 * fin (« Jamais »), il n'y a pas de limite : les calculs se font toujours sur une plage bornée.
 */
export const MAX_REPEAT_SPAN_DAYS = 3660;

/** Plage parcourue pour savoir si deux répétitions personnalisées tombent un même jour. */
const OVERLAP_SCAN_DAYS = 731;

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
 * - Répétition personnalisée (story 2) : `repeatUnit` non nul et `repeatEvery` de 1 à 99.
 *   - « semaine » : `weekday` non nul ; ce jour-là, une semaine sur `repeatEvery`, à compter de
 *     la semaine de `validFrom` (l'ancrage, toujours présent) ;
 *   - « jour », « mois », « an » : `weekday` nul ; tous les `repeatEvery` jours / mois / ans à
 *     partir de `validFrom` (voir `recurrence.ts` pour les mois courts).
 *   `validUntil` nul = sans fin.
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
  /** Unité de la répétition personnalisée ; absente ou nulle = hebdomadaire simple ou ponctuel. */
  repeatUnit?: RepeatUnit | null;
  /** « Tous les X » (1 à 99) ; absent = 1. */
  repeatEvery?: number;
}

/** Champs d'un bloc qui décident des jours où il a lieu. */
export type BlockDays = Pick<
  BlockSpec,
  "weekday" | "validFrom" | "validUntil" | "repeatUnit" | "repeatEvery"
>;

/** Vrai si le bloc revient (hebdomadaire ou répétition personnalisée), faux s'il est ponctuel. */
export function isRecurring(block: Pick<BlockSpec, "weekday" | "repeatUnit">): boolean {
  return block.weekday != null || block.repeatUnit != null;
}

/** Vrai pour un bloc « chaque semaine » simple (sans répétition personnalisée). */
function isSimpleWeekly(block: BlockDays): boolean {
  return block.weekday != null && block.repeatUnit == null && (block.repeatEvery ?? 1) === 1;
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

/**
 * Vrai si le bloc a lieu le jour `day`. Un bloc qui revient commence à `validFrom` et s'arrête
 * après `validUntil` ; une répétition « toutes les X … » se compte à partir de `validFrom`.
 */
export function occursOn(block: BlockDays, day: string): boolean {
  if (!isRecurring(block)) return block.validFrom === day;
  if (block.validFrom && day < block.validFrom) return false;
  if (block.validUntil && day > block.validUntil) return false;
  const every = block.repeatEvery ?? 1;
  if (block.weekday != null) {
    if (weekdayOf(day) !== block.weekday) return false;
    if (every === 1 || !block.validFrom) return true;
    return recursOn({ unit: "week", every, anchor: block.validFrom, weekday: block.weekday }, day);
  }
  const unit = block.repeatUnit;
  if (!unit || !block.validFrom) return false;
  return recursOn({ unit, every, anchor: block.validFrom }, day);
}

/**
 * Répétition d'un bloc, en mots (minuscules) : « chaque semaine », « toutes les 2 semaines »,
 * « chaque mois, le 31 (ou le dernier jour du mois) »… `null` pour un bloc ponctuel. Le jour de
 * semaine d'un bloc hebdomadaire n'est pas inclus (l'interface l'affiche à part).
 */
export function repeatLabel(block: BlockDays): string | null {
  if (!isRecurring(block)) return null;
  const every = block.repeatEvery ?? 1;
  if (block.weekday != null) return describeEvery(every, "week");
  if (!block.repeatUnit || !block.validFrom) return null;
  return describeRepeat({ unit: block.repeatUnit, every, anchor: block.validFrom });
}

/** Blocs qui ont lieu le jour `day`, triés par heure de début puis de fin. */
export function blocksOnDay<T extends BlockSpec>(blocks: readonly T[], day: string): T[] {
  return blocks
    .filter((b) => occursOn(b, day))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

/** Les jours (`yyyy-MM-dd`) où un bloc a lieu, sur une plage incluse. */
export function occurrencesIn(block: BlockDays, range: DateRange): string[] {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = shiftDay(d, 1)) {
    if (occursOn(block, d)) days.push(d);
  }
  return days;
}

/**
 * Vrai si deux blocs ont lieu au moins une fois le même jour (les heures ne comptent pas) :
 * même jour de semaine et sessions qui se croisent sur ce jour-là, ou ponctuel qui tombe
 * pendant un hebdomadaire, ou deux ponctuels le même jour. Avec une répétition personnalisée,
 * on cherche un jour commun dans les deux ans qui suivent le début de la période commune.
 */
export function shareADay(a: BlockDays, b: BlockDays): boolean {
  if (!isRecurring(a) || !isRecurring(b)) {
    const [once, other] = !isRecurring(a) ? [a, b] : [b, a];
    return once.validFrom != null && occursOn(other, once.validFrom);
  }
  if (!isSimpleWeekly(a) || !isSimpleWeekly(b)) {
    // Une répétition personnalisée a toujours un début : `from` n'est pas nul.
    const from = maxDay(a.validFrom, b.validFrom);
    if (from == null) return false;
    const limit = shiftDay(from, OVERLAP_SCAN_DAYS);
    const until = minDay(a.validUntil, b.validUntil);
    const end = until != null && until < limit ? until : limit;
    for (let d = from; d <= end; d = shiftDay(d, 1)) {
      if (occursOn(a, d) && occursOn(b, d)) return true;
    }
    return false;
  }
  if (a.weekday == null || a.weekday !== b.weekday) return false;
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
    if (!isSimpleWeekly(b) || !b.validFrom || !b.validUntil || b.validUntil < today) continue;
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

/** Fin d'une répétition personnalisée. */
export type RepeatEnd = "never" | "date" | "count";

/** Données brutes du formulaire « bloc ». */
export interface BlockFormInput {
  title: string;
  placeId: string | null;
  /** « HH:mm » */
  start: string;
  /** « HH:mm » */
  end: string;
  /** « Chaque semaine », « Une seule fois » ou « Personnalisée » (tous les X …). */
  kind: "weekly" | "once" | "custom";
  /** Jours cochés (hebdomadaire, ou personnalisée en semaines). */
  weekdays: number[];
  /** Jour (ponctuel), `yyyy-MM-dd`. */
  date: string;
  /**
   * Début et fin de session (hebdomadaire), `yyyy-MM-dd`. Pour une répétition personnalisée :
   * date de début (ancrage) et date de fin (si `repeatEnd` vaut « date »).
   */
  sessionStart: string;
  sessionEnd: string;
  /** Personnalisée : « tous les X » (texte du champ ou nombre). */
  repeatEvery?: string | number;
  /** Personnalisée : unité. */
  repeatUnit?: string;
  /** Personnalisée : fin (jamais, à une date, après N fois). */
  repeatEnd?: string;
  /** Personnalisée : nombre de fois (fin « après N fois »). */
  repeatCount?: string | number;
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
 * - ponctuel : un jour valide ;
 * - personnalisée : X entier de 1 à 99, unité jour / semaine / mois / an, date de début, au
 *   moins un jour coché en semaines, fin « jamais », à une date (≥ début, au plus 10 ans) ou
 *   « après N fois » (1 à 999, transformée en date de fin : la N-ième occurrence).
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
  if (r.kind === "custom") return validateCustom(r, base, options);
  if (r.kind !== "weekly") return { ok: false, error: "Type de bloc invalide." };

  const parsedDays = parseWeekdays(r.weekdays, options);
  if (!parsedDays.ok) return parsedDays;
  const days = parsedDays.value;
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
  const blocks = days.map((weekday) => ({
    ...base,
    weekday,
    validFrom: sessionStart,
    validUntil: sessionEnd,
  }));
  if (!blocks.some((b) => occurrencesIn(b, { from: sessionStart, to: sessionEnd }).length > 0)) {
    return { ok: false, error: "Aucun de ces jours ne tombe dans la session." };
  }
  return { ok: true, value: blocks };
}

/** Jours de semaine cochés → liste triée sans doublon (un seul si `single`). */
function parseWeekdays(raw: unknown, options: { single?: boolean }): ValidationResult<Weekday[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Coche au moins un jour de la semaine." };
  }
  const days = new Set<Weekday>();
  for (const d of raw) {
    if (typeof d !== "number" || !(WEEKDAYS as readonly number[]).includes(d)) {
      return { ok: false, error: "Jour de la semaine invalide." };
    }
    days.add(d as Weekday);
  }
  if (options.single && days.size !== 1) {
    return { ok: false, error: "Un bloc modifié a un seul jour de la semaine." };
  }
  return { ok: true, value: [...days].sort((a, b) => a - b) };
}

/** Nombre entier saisi (« 2 », 2) ; `null` si vide, négatif, décimal ou autre chose. */
function parseWhole(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

function tooLong(): ValidationResult<never> {
  return {
    ok: false,
    error: "La répétition dure plus de 10 ans : choisis « Jamais » ou une fin plus proche.",
  };
}

/** Validation d'une répétition personnalisée (« tous les X jours / semaines / mois / ans »). */
function validateCustom(
  r: Record<string, unknown>,
  base: Pick<BlockSpec, "title" | "placeId" | "startMinute" | "endMinute">,
  options: { single?: boolean },
): ValidationResult<BlockSpec[]> {
  const every = parseWhole(r.repeatEvery);
  if (!isValidEvery(every)) {
    return {
      ok: false,
      error: `Indique un nombre entier de 1 à ${REPEAT_EVERY_MAX} pour « tous les … ».`,
    };
  }
  const unit = r.repeatUnit;
  if (typeof unit !== "string" || !(REPEAT_UNITS as readonly string[]).includes(unit)) {
    return { ok: false, error: "Choisis l'unité : jours, semaines, mois ou ans." };
  }
  const repeatUnit = unit as RepeatUnit;
  if (!isDay(r.sessionStart)) return { ok: false, error: "Choisis la date de début." };
  const start = r.sessionStart;

  let weekdays: Weekday[] = [];
  if (repeatUnit === "week") {
    const parsed = parseWeekdays(r.weekdays, options);
    if (!parsed.ok) return parsed;
    weekdays = parsed.value;
  }

  let until: string | null;
  if (r.repeatEnd === "never") {
    until = null;
  } else if (r.repeatEnd === "date") {
    if (!isDay(r.sessionEnd)) return { ok: false, error: "Choisis la date de fin." };
    if (r.sessionEnd < start) {
      return { ok: false, error: "La date de fin doit être après la date de début." };
    }
    until = r.sessionEnd;
  } else if (r.repeatEnd === "count") {
    const count = parseWhole(r.repeatCount);
    if (count === null || count < 1 || count > REPEAT_COUNT_MAX) {
      return {
        ok: false,
        error: `Indique un nombre de fois entier de 1 à ${REPEAT_COUNT_MAX}.`,
      };
    }
    // Ordre de grandeur d'abord : 999 fois tous les 99 ans sortirait du calendrier.
    const periodDays = { day: 1, week: 7, month: 31, year: 366 }[repeatUnit];
    const periods = repeatUnit === "week" ? Math.ceil(count / weekdays.length) : count;
    if ((periods - 1) * every * periodDays > MAX_REPEAT_SPAN_DAYS + 366) return tooLong();
    until = nthOccurrence({ unit: repeatUnit, every, anchor: start }, count, weekdays);
  } else {
    return { ok: false, error: "Choisis quand la répétition s'arrête." };
  }
  if (until !== null && daysBetween(start, until) >= MAX_REPEAT_SPAN_DAYS) return tooLong();

  const common = { ...base, validFrom: start, validUntil: until, repeatUnit, repeatEvery: every };
  if (repeatUnit !== "week") return { ok: true, value: [{ ...common, weekday: null }] };

  const blocks = weekdays.map((weekday) => ({ ...common, weekday }));
  // Au moins un jour coché doit tomber avant la fin (ex. début un vendredi, fin le samedi,
  // seulement « lundi » coché : rien).
  const first = weekdays
    .map((w) => nthOccurrence({ unit: "week", every, anchor: start }, 1, [w]))
    .sort()[0];
  if (until !== null && first > until) {
    return { ok: false, error: "Aucun de ces jours ne tombe avant la date de fin." };
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
