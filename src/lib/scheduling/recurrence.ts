/**
 * Répétition personnalisée d'un bloc de l'horaire : « tous les X jours / semaines / mois /
 * ans » (story 2). Fonctions pures sur des jours `yyyy-MM-dd`, sans BD ni React, et sans
 * dépendre de `weeklyBlocks` (qui s'appuie sur ce module).
 *
 * Règles :
 * - Le **jour d'ancrage** (`anchor`) est la date de début choisie. La répétition se compte à
 *   partir de lui : « toutes les 2 semaines » = la semaine du début, puis une semaine sur deux.
 * - Semaines : on compte en semaines du lundi au dimanche. Plusieurs jours de semaine (ex. mar.
 *   et jeu.) partagent le même ancrage, donc la même alternance.
 * - Mois : le même quantième que l'ancrage. Un mois trop court prend son **dernier jour**
 *   (ancrage le 31 → 30 avril, 28 ou 29 février), et le mois suivant revient au 31 : l'ancrage
 *   ne « glisse » jamais.
 * - Ans : même mois et même quantième ; un 29 février devient le 28 les années non bissextiles.
 */
import { assertDay } from "./time";

/** Unité de répétition. */
export type RepeatUnit = "day" | "week" | "month" | "year";

export const REPEAT_UNITS: readonly RepeatUnit[] = ["day", "week", "month", "year"];

/** Plus grand « X » permis dans « tous les X … ». */
export const REPEAT_EVERY_MAX = 99;

/** Plus grand nombre de fois pour la fin « après N fois ». */
export const REPEAT_COUNT_MAX = 999;

/** Libellés français (singulier, pluriel) des unités. */
export const REPEAT_UNIT_LABEL: Record<RepeatUnit, { one: string; many: string }> = {
  day: { one: "jour", many: "jours" },
  week: { one: "semaine", many: "semaines" },
  month: { one: "mois", many: "mois" },
  year: { one: "an", many: "ans" },
};

/** Une règle de répétition. `weekday` (1 = lundi … 7 = dimanche) : unité « semaine » seulement. */
export interface RepeatRule {
  unit: RepeatUnit;
  every: number;
  anchor: string;
  weekday?: number | null;
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function ymd(day: string): Ymd {
  assertDay(day);
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

function fmt({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Numéro de jour depuis l'époque (calendrier pur, sans fuseau ni heure avancée). */
function dayNumber({ y, m, d }: Ymd): number {
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromDayNumber(n: number): string {
  const date = new Date(n * 86_400_000);
  return fmt({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

/** Jour ISO de la semaine (1 = lundi … 7 = dimanche) d'un numéro de jour. */
function isoWeekday(n: number): number {
  // 1970-01-01 (jour 0) était un jeudi (4).
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** Nombre de jours du mois `m` (1-12) de l'année `y`. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Le jour `d` du mois, ramené au dernier jour si le mois est trop court. */
function clampedDay(y: number, m: number, d: number): number {
  return Math.min(d, daysInMonth(y, m));
}

/** Vrai si `every` est un entier de 1 à `REPEAT_EVERY_MAX`. */
export function isValidEvery(every: unknown): every is number {
  return Number.isInteger(every) && (every as number) >= 1 && (every as number) <= REPEAT_EVERY_MAX;
}

function assertRule(rule: RepeatRule): void {
  if (!isValidEvery(rule.every)) throw new Error(`Intervalle invalide : ${rule.every}`);
  if (!REPEAT_UNITS.includes(rule.unit)) throw new Error(`Unité invalide : ${rule.unit}`);
  assertDay(rule.anchor);
}

/** Jour de semaine effectif d'une règle « semaine » (celui de l'ancrage s'il n'est pas donné). */
function ruleWeekday(rule: RepeatRule, anchorN: number): number {
  return rule.weekday ?? isoWeekday(anchorN);
}

/** Vrai si la règle tombe le jour `day` (jamais avant l'ancrage). */
export function recursOn(rule: RepeatRule, day: string): boolean {
  assertRule(rule);
  const a = ymd(rule.anchor);
  const t = ymd(day);
  const aN = dayNumber(a);
  const tN = dayNumber(t);
  if (tN < aN) return false;
  switch (rule.unit) {
    case "day":
      return (tN - aN) % rule.every === 0;
    case "week": {
      if (isoWeekday(tN) !== ruleWeekday(rule, aN)) return false;
      const aMonday = aN - (isoWeekday(aN) - 1);
      const tMonday = tN - (isoWeekday(tN) - 1);
      return ((tMonday - aMonday) / 7) % rule.every === 0;
    }
    case "month": {
      const months = (t.y - a.y) * 12 + (t.m - a.m);
      return months % rule.every === 0 && t.d === clampedDay(t.y, t.m, a.d);
    }
    case "year": {
      const years = t.y - a.y;
      return t.m === a.m && years % rule.every === 0 && t.d === clampedDay(t.y, t.m, a.d);
    }
  }
}

/**
 * La `k`-ième période (k = 0 : celle de l'ancrage) d'une règle jour / mois / an. Toujours
 * calculée depuis l'ancrage : un 31 ramené au 30 avril redevient le 31 en mai.
 */
function periodDay(rule: RepeatRule, k: number): string {
  const a = ymd(rule.anchor);
  switch (rule.unit) {
    case "day":
      return fromDayNumber(dayNumber(a) + k * rule.every);
    case "month": {
      const total = a.m - 1 + k * rule.every;
      const y = a.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      return fmt({ y, m, d: clampedDay(y, m, a.d) });
    }
    case "year": {
      const y = a.y + k * rule.every;
      return fmt({ y, m: a.m, d: clampedDay(y, a.m, a.d) });
    }
    case "week":
      throw new Error("Utiliser nthWeeklyOccurrence pour les semaines.");
  }
}

/**
 * Jour de la `n`-ième occurrence (n ≥ 1) d'une répétition. Pour les semaines, `weekdays` donne
 * les jours cochés (ex. mar. et jeu.) : les occurrences de tous ces jours se comptent ensemble,
 * dans l'ordre, sans compter les jours de la première semaine qui tombent avant l'ancrage.
 * Sert à transformer la fin « après N fois » en date de fin.
 */
export function nthOccurrence(
  rule: Omit<RepeatRule, "weekday">,
  n: number,
  weekdays: readonly number[] = [],
): string {
  assertRule(rule);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Nombre de fois invalide : ${n}`);
  if (rule.unit !== "week") return periodDay(rule, n - 1);

  const aN = dayNumber(ymd(rule.anchor));
  const days = [...new Set(weekdays.length ? weekdays : [isoWeekday(aN)])].sort((x, y) => x - y);
  if (days.some((w) => !Number.isInteger(w) || w < 1 || w > 7)) {
    throw new Error("Jour de semaine invalide.");
  }
  const aMonday = aN - (isoWeekday(aN) - 1);
  let count = 0;
  for (let week = 0; ; week += rule.every) {
    for (const w of days) {
      const dayN = aMonday + week * 7 + (w - 1);
      if (dayN < aN) continue;
      count += 1;
      if (count === n) return fromDayNumber(dayN);
    }
  }
}

/**
 * « tous les jours », « tous les 3 jours », « toutes les 2 semaines », « chaque mois »,
 * « tous les 6 mois », « chaque année », « tous les 2 ans » (en minuscules).
 */
export function describeEvery(every: number, unit: RepeatUnit): string {
  const label = REPEAT_UNIT_LABEL[unit];
  if (every === 1) {
    if (unit === "day") return "tous les jours";
    if (unit === "week") return "chaque semaine";
    if (unit === "month") return "chaque mois";
    return "chaque année";
  }
  const all = unit === "week" ? "toutes les" : "tous les";
  return `${all} ${every} ${label.many}`;
}

/**
 * Description complète d'une répétition jour / mois / an à partir de son ancrage :
 * « tous les 3 jours », « chaque mois, le 31 (ou le dernier jour du mois) »,
 * « chaque année, le 14 février ». Les semaines se décrivent avec leur jour (voir l'interface).
 */
export function describeRepeat(rule: Omit<RepeatRule, "weekday">): string {
  assertRule(rule);
  const base = describeEvery(rule.every, rule.unit);
  const a = ymd(rule.anchor);
  if (rule.unit === "month") {
    const quantieme = a.d === 1 ? "1er" : String(a.d);
    return a.d > 28
      ? `${base}, le ${quantieme} (ou le dernier jour du mois)`
      : `${base}, le ${quantieme}`;
  }
  if (rule.unit === "year") {
    const months = [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ];
    return `${base}, le ${a.d === 1 ? "1er" : a.d} ${months[a.m - 1]}`;
  }
  return base;
}
