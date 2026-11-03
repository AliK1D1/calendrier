/**
 * Planificateur d'étude (section 3 bis du plan) : à partir des examens et travaux d'une
 * personne, propose des séances d'étude réalistes dans ses vrais moments libres.
 *
 * Fonctions pures : aucune BD, aucun React. Le fournisseur de trajets et « maintenant » sont
 * injectés. Les séances proposées n'occupent rien : seules les séances **acceptées** (passées
 * dans `options.accepted`) comptent comme occupées.
 *
 * Réalisme (comme les rencontres) : une séance a lieu là où la personne est déjà (le lieu du
 * bloc d'avant ou d'après, ex. le cégep entre deux cours) ou à la maison. Si la fenêtre
 * implique de changer de lieu, le trajet et la marge sont retirés avec le même calcul que
 * `findMeetups` (`availabilityInWindow`). Une fenêtre trop courte une fois le trajet retiré est
 * ignorée.
 */
import { formatInTimeZone } from "date-fns-tz";

import { availabilityInWindow, memoizeTravel } from "./findMeetups";
import { getFreeWindows } from "./freeWindows";
import {
  TIME_ZONE,
  MS_PER_MINUTE,
  addMinutesTo,
  eachDay,
  minutesBetween,
  zonedDayBounds,
  zonedTime,
} from "./time";
import type { TravelTimeProvider } from "./travel";
import type {
  BusyBlock,
  Deadline,
  Difficulty,
  Person,
  Place,
  PlaceId,
  StudyPreferences,
  StudySession,
  StudySessionKind,
} from "./types";
import { daysBetween, parseClock, shiftDay, weekdayOf } from "./weeklyBlocks";

/** Pas des séances (début et durée), en minutes : comme la grille de /horaire. */
export const STUDY_STEP_MINUTES = 15;

/** Heures d'étude par défaut selon la difficulté, quand l'estimation n'est pas connue. */
export const DEFAULT_HOURS_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = {
  1: 3,
  2: 5,
  3: 8,
};

/** Préférences par défaut (modifiables dans /profil). */
export const DEFAULT_STUDY_PREFERENCES: StudyPreferences = {
  minSessionMinutes: 45,
  maxSessionMinutes: 120,
  maxStudyMinutesPerDay: 180,
  breakMinutes: 15,
  studyHours: { start: "08:00", end: "22:00" },
  eveCutoff: "21:00",
  keepFreeRatio: 0.3,
  eveningStart: "18:00",
  bufferMinutes: 5,
  windowDays: 14,
};

/** Bornes des préférences (aussi appliquées par la BD, migration 0011). */
export const STUDY_LIMITS = {
  minSession: { min: 30, max: 120 },
  maxSession: { min: 30, max: 240 },
  maxPerDay: { min: 30, max: 600 },
  breakMinutes: { min: 0, max: 60 },
  keepFreeRatio: { min: 0, max: 0.9 },
  bufferMinutes: { min: 0, max: 30 },
  windowDays: { min: 1, max: 28 },
} as const;

/**
 * La veille, au plus cette part des heures nécessaires (seulement quand le temps manque
 * ailleurs) : « jamais tout la veille ». En temps normal, la veille n'a qu'une courte révision.
 */
export const EVE_MAX_SHARE = 0.5;

/** Raison d'un avertissement. */
export type StudyWarningKind = "missing" | "past" | "today";

/** Avertissement affiché à la personne. */
export interface StudyWarning {
  kind: StudyWarningKind;
  deadlineId: string;
  /** Minutes qui n'ont pas pu être placées (0 sauf pour « missing »). */
  missingMinutes: number;
  /** Message prêt à afficher (« Il te manque 2 h avant l'examen de chimie. »). */
  message: string;
}

/** Résultat du planificateur. */
export interface StudyPlan {
  /** Séances proposées, dans l'ordre chronologique. */
  sessions: StudySession[];
  warnings: StudyWarning[];
}

/** Options du planificateur. */
export interface StudyPlanOptions {
  /**
   * Séances déjà acceptées (toutes échéances) : elles comptent comme occupées, dans le maximum
   * par jour, et dans les heures déjà faites pour leur échéance.
   */
  accepted?: readonly StudySession[];
  /**
   * Lieux où la personne peut étudier (en général : ses lieux à elle). La maison est toujours
   * permise. Défaut : tous les lieux de `person.places`.
   */
  studyPlaceIds?: readonly PlaceId[];
  /** Fuseau des jours et des heures. Défaut : America/Toronto. */
  timeZone?: string;
}

// ─── Petits outils ───────────────────────────────────────────────────────────────────────

const STEP_MS = STUDY_STEP_MINUTES * MS_PER_MINUTE;
const ceilStep = (d: Date) => new Date(Math.ceil(d.getTime() / STEP_MS) * STEP_MS);
const floorStep = (d: Date) => new Date(Math.floor(d.getTime() / STEP_MS) * STEP_MS);
const ceilMinutes = (m: number) => Math.ceil(m / STUDY_STEP_MINUTES) * STUDY_STEP_MINUTES;
const floorMinutes = (m: number) => Math.floor(m / STUDY_STEP_MINUTES) * STUDY_STEP_MINUTES;
const len = (s: { start: Date; end: Date }) => minutesBetween(s.start, s.end);

function overlapMinutes(a: { start: Date; end: Date }, b: { start: Date; end: Date }): number {
  const start = Math.max(a.start.getTime(), b.start.getTime());
  const end = Math.min(a.end.getTime(), b.end.getTime());
  return end > start ? (end - start) / MS_PER_MINUTE : 0;
}

/** Durée lisible : « 2 h », « 1 h 30 », « 45 min ». */
export function formatStudyDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** « l'examen de chimie », « le travail d'anglais ». */
export function deadlineLabel(d: Pick<Deadline, "kind" | "course">): string {
  const course = d.course.trim();
  const de = /^[aeiouyhàâäéèêëîïôöùûü]/i.test(course) ? `d'${course}` : `de ${course}`;
  return `${d.kind === "exam" ? "l'examen" : "le travail"} ${de}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Minutes d'étude nécessaires : estimation de la personne, sinon défaut selon la difficulté. */
export function requiredMinutes(d: Pick<Deadline, "estimatedHours" | "difficulty">): number {
  const hours =
    d.estimatedHours != null && Number.isFinite(d.estimatedHours) && d.estimatedHours > 0
      ? d.estimatedHours
      : DEFAULT_HOURS_BY_DIFFICULTY[d.difficulty];
  return ceilMinutes(hours * 60);
}

/** Vérifie les préférences (bornes, cohérence). Lève une erreur claire sinon. */
export function assertStudyPreferences(p: StudyPreferences): void {
  const int = (v: number, lo: number, hi: number, what: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new Error(`Préférence invalide (${what}) : ${v}`);
    }
  };
  int(p.minSessionMinutes, STUDY_LIMITS.minSession.min, STUDY_LIMITS.minSession.max, "durée min");
  int(p.maxSessionMinutes, p.minSessionMinutes, STUDY_LIMITS.maxSession.max, "durée max");
  int(p.maxStudyMinutesPerDay, p.minSessionMinutes, STUDY_LIMITS.maxPerDay.max, "max par jour");
  int(p.breakMinutes, STUDY_LIMITS.breakMinutes.min, STUDY_LIMITS.breakMinutes.max, "pause");
  int(p.bufferMinutes, STUDY_LIMITS.bufferMinutes.min, STUDY_LIMITS.bufferMinutes.max, "marge");
  int(p.windowDays, STUDY_LIMITS.windowDays.min, STUDY_LIMITS.windowDays.max, "jours");
  if (p.minSessionMinutes % STUDY_STEP_MINUTES || p.maxSessionMinutes % STUDY_STEP_MINUTES) {
    throw new Error("Les durées de séance doivent être des multiples de 15 minutes.");
  }
  if (
    !Number.isFinite(p.keepFreeRatio) ||
    p.keepFreeRatio < STUDY_LIMITS.keepFreeRatio.min ||
    p.keepFreeRatio > STUDY_LIMITS.keepFreeRatio.max
  ) {
    throw new Error(`Préférence invalide (temps gardé libre) : ${p.keepFreeRatio}`);
  }
  const start = parseClock(p.studyHours.start);
  const end = parseClock(p.studyHours.end);
  if (start === null || end === null || end - start < p.minSessionMinutes) {
    throw new Error("Heures d'étude invalides.");
  }
  if (p.eveCutoff !== null && parseClock(p.eveCutoff) === null) {
    throw new Error("Heure limite de la veille invalide.");
  }
  if (parseClock(p.eveningStart) === null) throw new Error("Début de soirée invalide.");
}

// ─── Contexte de calcul partagé (planification et replanification) ───────────────────────

interface Interval {
  start: Date;
  end: Date;
  placeId: PlaceId;
}

interface DayInfo {
  start: Date;
  end: Date;
  /** Début de la soirée (pour `keepFreeRatio`). */
  evening: Date;
  /** Maximum d'étude ce jour-là (préférence, et part gardée libre la fin de semaine). */
  cap: number;
  /** Maximum d'étude en soirée ce jour-là. */
  eveningCap: number;
}

class StudyContext {
  readonly travel: TravelTimeProvider;
  readonly placeById: Map<PlaceId, Place>;
  readonly allowed: Set<PlaceId>;
  readonly notBefore: Date;
  readonly today: string;
  /** Séances qui occupent déjà du temps : acceptées, puis proposées au fil du calcul. */
  readonly sessions: StudySession[];
  private readonly days = new Map<string, DayInfo>();

  constructor(
    readonly person: Person,
    readonly prefs: StudyPreferences,
    travel: TravelTimeProvider,
    now: Date,
    accepted: readonly StudySession[],
    studyPlaceIds: readonly PlaceId[] | undefined,
    readonly timeZone: string,
  ) {
    assertStudyPreferences(prefs);
    if (!Number.isFinite(now.getTime())) throw new Error("« Maintenant » est invalide.");
    this.travel = memoizeTravel(travel);
    this.placeById = new Map(person.places.map((p) => [p.id, p]));
    this.allowed = new Set([
      ...(studyPlaceIds ?? person.places.map((p) => p.id)),
      person.homePlaceId,
    ]);
    this.notBefore = ceilStep(now);
    this.today = this.localDay(now);
    this.sessions = [...accepted];
  }

  localDay(instant: Date): string {
    return formatInTimeZone(instant, this.timeZone, "yyyy-MM-dd");
  }

  place(id: PlaceId): Place {
    const p = this.placeById.get(id);
    if (!p) throw new Error(`Lieu inconnu : ${id}`);
    return p;
  }

  /** Blocs de la personne qui touchent la journée (le reste ne change rien au calcul). */
  private blocksNear(start: Date, end: Date): BusyBlock[] {
    return this.person.busyBlocks.filter(
      (b) => b.end.getTime() >= start.getTime() && b.start.getTime() <= end.getTime(),
    );
  }

  /** Une séance vue comme un bloc occupé, élargie de `pad` minutes de chaque côté. */
  private static asBlock(s: StudySession, pad: number, i: number): BusyBlock {
    return {
      id: `etude-${i}`,
      start: addMinutesTo(s.start, -pad),
      end: addMinutesTo(s.end, pad),
      placeId: s.placeId,
      title: "Étude",
    };
  }

  /** Bornes de la journée, plafond d'étude et plafond de soirée. Mis en cache. */
  day(day: string): DayInfo {
    const cached = this.days.get(day);
    if (cached) return cached;
    const { start, end } = zonedDayBounds(day, this.timeZone);
    const hoursStart = zonedTime(day, this.prefs.studyHours.start, this.timeZone);
    const hoursEnd = zonedTime(day, this.prefs.studyHours.end, this.timeZone);
    const evening = zonedTime(day, this.prefs.eveningStart, this.timeZone);
    // Temps libre « de base » (sans aucune séance d'étude), dans les heures d'étude.
    const person = { ...this.person, busyBlocks: this.blocksNear(start, end) };
    let free = 0;
    let freeEvening = 0;
    for (const w of getFreeWindows(person, start, end)) {
      const clipped = {
        start: w.start < hoursStart ? hoursStart : w.start,
        end: w.end > hoursEnd ? hoursEnd : w.end,
      };
      if (clipped.end <= clipped.start) continue;
      free += len(clipped);
      freeEvening += overlapMinutes(clipped, { start: evening, end });
    }
    const keep = 1 - this.prefs.keepFreeRatio;
    const weekend = weekdayOf(day) >= 6;
    const info: DayInfo = {
      start,
      end,
      evening,
      cap: weekend
        ? Math.min(this.prefs.maxStudyMinutesPerDay, floorMinutes(free * keep))
        : this.prefs.maxStudyMinutesPerDay,
      eveningCap: floorMinutes(freeEvening * keep),
    };
    this.days.set(day, info);
    return info;
  }

  /** Minutes d'étude déjà placées ce jour-là (toutes, et en soirée). */
  used(day: string): { total: number; evening: number } {
    const info = this.day(day);
    let total = 0;
    let evening = 0;
    for (const s of this.sessions) {
      const t = overlapMinutes(s, info);
      if (t === 0) continue;
      total += t;
      evening += overlapMinutes(s, { start: info.evening, end: info.end });
    }
    return { total, evening };
  }

  /**
   * Intervalles où l'on peut étudier ce jour-là : pour chaque fenêtre libre (séances déjà
   * placées comprises, élargies de la pause), le meilleur lieu parmi le lieu d'avant, le lieu
   * d'après et la maison (trajets et marge retirés), coupé aux heures d'étude, à « maintenant »
   * et à `endLimit`.
   */
  async usable(day: string, endLimit: Date | null): Promise<Interval[]> {
    const info = this.day(day);
    const hoursStart = zonedTime(day, this.prefs.studyHours.start, this.timeZone);
    let hoursEnd = zonedTime(day, this.prefs.studyHours.end, this.timeZone);
    if (endLimit && endLimit < hoursEnd) hoursEnd = endLimit;
    const from = this.notBefore > hoursStart ? this.notBefore : hoursStart;
    if (hoursEnd <= from) return [];

    const pad = this.prefs.breakMinutes;
    const extra = this.sessions.map((s, i) => StudyContext.asBlock(s, pad, i));
    const person = { ...this.person, busyBlocks: this.blocksNear(info.start, info.end) };
    const windows = getFreeWindows(person, info.start, info.end, { extraBusyBlocks: extra });

    const out: Interval[] = [];
    for (const w of windows) {
      if (w.end <= from || w.start >= hoursEnd) continue;
      const before = this.place(w.placeBeforeId);
      const after = this.place(w.placeAfterId);
      const candidates = [...new Set([w.placeBeforeId, w.placeAfterId, this.person.homePlaceId])];
      let best: Interval | null = null;
      for (const id of candidates) {
        if (!this.allowed.has(id)) continue;
        const p = this.place(id);
        const leg = {
          to: await this.travel.minutes(before, p, this.person.travelMode),
          from: await this.travel.minutes(p, after, this.person.travelMode),
        };
        const slot = availabilityInWindow(w, leg, this.prefs.bufferMinutes);
        if (!slot) continue;
        const start = ceilStep(slot.start > from ? slot.start : from);
        const end = floorStep(slot.end < hoursEnd ? slot.end : hoursEnd);
        if (end <= start) continue;
        if (!best || len({ start, end }) > len(best)) best = { start, end, placeId: id };
      }
      if (best) out.push(best);
    }
    return out;
  }

  /**
   * Longueur permise pour une séance qui commence à `start` ce jour-là : au plus `wanted`,
   * dans la place qui reste (`room`), le maximum du jour et celui de la soirée. 0 si moins
   * que la durée minimale.
   */
  allowedLength(day: string, start: Date, room: number, wanted: number): number {
    const info = this.day(day);
    const used = this.used(day);
    let length = Math.min(this.prefs.maxSessionMinutes, room, wanted, info.cap - used.total);
    const eveningLeft = info.eveningCap - used.evening;
    const beforeEvening = Math.max(0, minutesBetween(start, info.evening));
    if (length > beforeEvening + eveningLeft) length = beforeEvening + Math.max(0, eveningLeft);
    length = floorMinutes(length);
    return length >= this.prefs.minSessionMinutes ? length : 0;
  }

  /** Limite de fin d'une séance pour une échéance, ce jour-là (échéance, veille). */
  endLimit(day: string, deadline: Deadline): Date | null {
    const dueDay = this.localDay(deadline.dueAt);
    if (day === dueDay) return deadline.dueAt;
    if (day === shiftDay(dueDay, -1) && deadline.kind === "exam" && this.prefs.eveCutoff) {
      const cutoff = zonedTime(day, this.prefs.eveCutoff, this.timeZone);
      return cutoff < deadline.dueAt ? cutoff : deadline.dueAt;
    }
    return deadline.dueAt;
  }

  /**
   * Place jusqu'à `target` minutes d'étude pour `deadline` ce jour-là, en séances de durée
   * permise, dans l'ordre chronologique. `maxSessions` borne le nombre de séances. Renvoie les
   * minutes placées.
   */
  async fillDay(
    day: string,
    deadline: Deadline,
    target: number,
    kind: StudySessionKind,
    maxSessions = Infinity,
  ): Promise<number> {
    if (target <= 0) return 0;
    let placed = 0;
    let count = 0;
    for (const iv of await this.usable(day, this.endLimit(day, deadline))) {
      let start = iv.start;
      while (placed < target && count < maxSessions) {
        const wanted = Math.max(this.prefs.minSessionMinutes, ceilMinutes(target - placed));
        const length = this.allowedLength(day, start, len({ start, end: iv.end }), wanted);
        if (length === 0) break;
        const end = addMinutesTo(start, length);
        this.sessions.push({ deadlineId: deadline.id, start, end, placeId: iv.placeId, kind });
        placed += length;
        count++;
        start = addMinutesTo(end, this.prefs.breakMinutes);
      }
      if (placed >= target || count >= maxSessions) break;
    }
    return placed;
  }
}

// ─── Planification ───────────────────────────────────────────────────────────────────────

/** Poids d'un jour selon sa distance à l'échéance (0 = le jour même, 1 = la veille). */
export function dayWeight(daysBefore: number): number {
  if (daysBefore === 0) return 0.5; // le matin même : en dernier recours
  if (daysBefore === 1) return 0; // la veille : seulement la courte révision
  if (daysBefore <= 3) return 3;
  if (daysBefore <= 5) return 2;
  return 1;
}

/**
 * Répartit `total` minutes sur des jours pondérés : chaque jour reçoit sa part, au moins une
 * séance minimale, en commençant par les jours les plus lourds (puis les plus proches de
 * l'échéance) jusqu'à ce que le total soit atteint. Le reste trop court pour une séance est
 * ajouté au jour le plus lourd. Renvoie les cibles par jour (les jours non listés : 0).
 */
export function distributeMinutes(
  total: number,
  days: ReadonlyArray<{ day: string; daysBefore: number }>,
  minSession: number,
  maxSession: number,
): Map<string, number> {
  const targets = new Map<string, number>();
  const weighted = days
    .map((d) => ({ ...d, w: dayWeight(d.daysBefore) }))
    .filter((d) => d.w > 0)
    .sort((a, b) => b.w - a.w || a.daysBefore - b.daysBefore);
  const sumW = weighted.reduce((s, d) => s + d.w, 0);
  if (total <= 0 || sumW === 0) return targets;
  let assigned = 0;
  for (const d of weighted) {
    const left = total - assigned;
    if (left <= 0) break;
    if (left < minSession && targets.size > 0) {
      // Reste trop court pour une séance : on l'ajoute au jour le plus lourd.
      const first = weighted[0].day;
      targets.set(first, (targets.get(first) ?? 0) + left);
      assigned += left;
      break;
    }
    const share = ceilMinutes((total * d.w) / sumW);
    const t = Math.min(
      left > minSession ? left : minSession,
      Math.max(minSession, share),
      2 * maxSession,
    );
    targets.set(d.day, t);
    assigned += t;
  }
  return targets;
}

interface DeadlineState {
  deadline: Deadline;
  dueDay: string;
  remaining: number;
  required: number;
  active: boolean;
}

/**
 * Propose des séances d'étude (section 3 bis) :
 *
 * 1. Échéances triées par date, puis par charge (la plus lourde d'abord).
 * 2. Une échéance passée : rien (avertissement). Aujourd'hui : au plus une courte révision.
 * 3. Une courte révision (durée minimale) la veille, avant l'heure limite du soir.
 * 4. Le reste est étalé sur les `windowDays` jours d'avant, avec plus de poids 2 et 3 jours
 *    avant, puis 4 et 5 jours avant (`dayWeight`). Le matin même ne sert qu'en dernier recours.
 * 5. Ce qui n'a pas pu être placé est cherché ailleurs, des jours les plus proches aux plus
 *    éloignés (la veille au plus `EVE_MAX_SHARE` des heures) ; s'il manque encore du temps,
 *    avertissement (« Il te manque 2 h avant l'examen de chimie. ») au lieu de surcharger.
 *
 * Toujours : séances de `minSessionMinutes` à `maxSessionMinutes`, par pas de 15 min, au plus
 * `maxStudyMinutesPerDay` par jour (séances acceptées comprises), une pause entre deux séances,
 * dans les heures d'étude, et `keepFreeRatio` du temps libre des soirées et des fins de semaine
 * gardé libre. Les séances ne chevauchent jamais un bloc occupé ni le trajet pour s'y rendre.
 */
export async function planStudySessions(
  person: Person,
  deadlines: readonly Deadline[],
  prefs: StudyPreferences,
  travelProvider: TravelTimeProvider,
  now: Date,
  options: StudyPlanOptions = {},
): Promise<StudyPlan> {
  const accepted = options.accepted ?? [];
  const ctx = new StudyContext(
    person,
    prefs,
    travelProvider,
    now,
    accepted,
    options.studyPlaceIds,
    options.timeZone ?? TIME_ZONE,
  );
  const warnings: StudyWarning[] = [];

  const states: DeadlineState[] = deadlines.map((deadline) => {
    if (!Number.isFinite(deadline.dueAt.getTime())) {
      throw new Error(`Échéance invalide : ${deadline.id}`);
    }
    const required = requiredMinutes(deadline);
    const done = accepted
      .filter((s) => s.deadlineId === deadline.id)
      .reduce((sum, s) => sum + len(s), 0);
    return {
      deadline,
      dueDay: ctx.localDay(deadline.dueAt),
      required,
      remaining: required - done,
      active: true,
    };
  });
  states.sort(
    (a, b) =>
      a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime() ||
      b.remaining - a.remaining ||
      a.deadline.id.localeCompare(b.deadline.id),
  );

  // Étape 0 : échéances passées ou aujourd'hui, et courtes révisions de la veille.
  for (const st of states) {
    const d = st.deadline;
    const label = deadlineLabel(d);
    if (d.dueAt.getTime() <= now.getTime()) {
      st.active = false;
      warnings.push({
        kind: "past",
        deadlineId: d.id,
        missingMinutes: 0,
        message: `${capitalize(label)} est déjà passé : rien de proposé.`,
      });
      continue;
    }
    if (st.remaining <= 0) {
      st.active = false;
      continue;
    }
    if (st.dueDay === ctx.today) {
      st.active = false;
      const placed = await ctx.fillDay(st.dueDay, d, prefs.minSessionMinutes, "review", 1);
      warnings.push({
        kind: "today",
        deadlineId: d.id,
        missingMinutes: 0,
        message:
          placed > 0
            ? `${capitalize(label)} est aujourd'hui : seulement une courte révision.`
            : `${capitalize(label)} est aujourd'hui : pas de moment libre pour une courte révision.`,
      });
      continue;
    }
    const eve = shiftDay(st.dueDay, -1);
    const hasEveSession = ctx.sessions.some(
      (s) => s.deadlineId === d.id && ctx.localDay(s.start) === eve,
    );
    if (eve >= ctx.today && !hasEveSession) {
      const review = Math.min(prefs.minSessionMinutes, Math.max(st.remaining, 0));
      st.remaining -= await ctx.fillDay(eve, d, review, "review", 1);
    }
  }

  // Étapes 1 et 2, une échéance à la fois (la plus proche d'abord) : elle prend ce qu'il lui
  // faut avant que la suivante ne se serve.
  const daysOf = (st: DeadlineState) => {
    const first = shiftDay(st.dueDay, -prefs.windowDays);
    const from = first > ctx.today ? first : ctx.today;
    return from > st.dueDay
      ? []
      : eachDay(from, st.dueDay).map((day) => ({ day, daysBefore: daysBetween(day, st.dueDay) }));
  };
  for (const st of states) {
    if (!st.active || st.remaining <= 0) continue;
    const days = daysOf(st);

    // Étape 1 : répartition espacée.
    const targets = distributeMinutes(
      st.remaining,
      days,
      prefs.minSessionMinutes,
      prefs.maxSessionMinutes,
    );
    for (const { day } of days) {
      const target = Math.min(targets.get(day) ?? 0, st.remaining);
      if (target > 0) st.remaining -= await ctx.fillDay(day, st.deadline, target, "study");
    }

    // Étape 2 : ce qui manque, des jours les plus proches aux plus éloignés.
    const closest = [...days].sort((a, b) => a.daysBefore - b.daysBefore);
    for (const { day, daysBefore } of closest) {
      if (st.remaining <= 0) break;
      let target = st.remaining;
      if (daysBefore === 1) {
        // La veille : au plus EVE_MAX_SHARE des heures nécessaires, révision comprise.
        const onEve = ctx.sessions
          .filter((s) => s.deadlineId === st.deadline.id && ctx.localDay(s.start) === day)
          .reduce((sum, s) => sum + len(s), 0);
        const room = floorMinutes(st.required * EVE_MAX_SHARE) - onEve;
        if (room < prefs.minSessionMinutes) continue;
        target = Math.min(target, room);
      }
      // La dernière séance peut dépasser un peu (durée minimale), jamais plus.
      st.remaining -= await ctx.fillDay(day, st.deadline, target, "study");
    }
    if (st.remaining > 0) {
      warnings.push({
        kind: "missing",
        deadlineId: st.deadline.id,
        missingMinutes: st.remaining,
        message: `Il te manque ${formatStudyDuration(st.remaining)} avant ${deadlineLabel(st.deadline)}.`,
      });
    }
  }

  const proposed = ctx.sessions.slice(accepted.length);
  proposed.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.deadlineId.localeCompare(b.deadlineId),
  );
  return { sessions: proposed, warnings };
}

// ─── Vérification d'une séance (déplacement, acceptation, conflits) ─────────────────────

/**
 * Vrai si la séance tient dans l'horaire : elle est dans une fenêtre libre (blocs de la
 * personne et `others` comptés comme occupés), et il reste le temps d'arriver à son lieu
 * depuis le lieu d'avant et de repartir vers le lieu d'après (trajets + marge). Une séance
 * qui traverse minuit est refusée.
 */
export async function sessionFits(
  person: Person,
  session: Pick<StudySession, "start" | "end" | "placeId">,
  others: ReadonlyArray<Pick<StudySession, "start" | "end" | "placeId">>,
  travelProvider: TravelTimeProvider,
  bufferMinutes: number,
  timeZone: string = TIME_ZONE,
): Promise<boolean> {
  const { start, end } = session;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return false;
  }
  const day = formatInTimeZone(start, timeZone, "yyyy-MM-dd");
  const bounds = zonedDayBounds(day, timeZone);
  if (end > bounds.end) return false;
  const places = new Map(person.places.map((p) => [p.id, p]));
  const place = places.get(session.placeId);
  if (!place) return false;
  const near = person.busyBlocks.filter((b) => b.end >= bounds.start && b.start <= bounds.end);
  const extra: BusyBlock[] = others.map((o, i) => ({
    id: `autre-${i}`,
    start: o.start,
    end: o.end,
    placeId: o.placeId,
    title: "Étude",
  }));
  const windows = getFreeWindows({ ...person, busyBlocks: near }, bounds.start, bounds.end, {
    extraBusyBlocks: extra,
  });
  const w = windows.find((x) => x.start <= start && end <= x.end);
  if (!w) return false;
  const before = places.get(w.placeBeforeId);
  const after = places.get(w.placeAfterId);
  if (!before || !after) return false;
  const leg = {
    to: await travelProvider.minutes(before, place, person.travelMode),
    from: await travelProvider.minutes(place, after, person.travelMode),
  };
  const slot = availabilityInWindow(w, leg, bufferMinutes);
  return slot !== null && slot.start <= start && end <= slot.end;
}

/**
 * Revalide une séance proposée (éventuellement déplacée à la main) avant de l'enregistrer.
 * Renvoie `null` si elle est valable, sinon un message en français.
 *
 * Vérifie : pas de 15 min, durée entre le minimum et le maximum des préférences, pas déjà
 * commencée, finie avant l'échéance, à un lieu permis, et `sessionFits` (aucun bloc occupé,
 * aucune autre séance, trajets compris). Le maximum par jour et les heures d'étude guident les
 * propositions, mais une séance placée à la main peut en sortir.
 */
export async function checkStudySession(
  person: Person,
  session: StudySession,
  deadline: Deadline,
  others: ReadonlyArray<Pick<StudySession, "start" | "end" | "placeId">>,
  prefs: StudyPreferences,
  travelProvider: TravelTimeProvider,
  now: Date,
  studyPlaceIds?: readonly PlaceId[],
  timeZone: string = TIME_ZONE,
): Promise<string | null> {
  const { start, end } = session;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "Heure invalide.";
  }
  if (start.getTime() % STEP_MS !== 0 || end.getTime() % STEP_MS !== 0) {
    return "Les séances commencent et finissent au quart d'heure.";
  }
  const minutes = minutesBetween(start, end);
  if (minutes < prefs.minSessionMinutes || minutes > prefs.maxSessionMinutes) {
    return `Une séance dure de ${formatStudyDuration(prefs.minSessionMinutes)} à ${formatStudyDuration(prefs.maxSessionMinutes)}.`;
  }
  if (start.getTime() < now.getTime()) return "Cette séance est déjà commencée ou passée.";
  if (end.getTime() > deadline.dueAt.getTime()) {
    return `Cette séance finit après ${deadlineLabel(deadline)}.`;
  }
  const allowed = new Set([
    ...(studyPlaceIds ?? person.places.map((p) => p.id)),
    person.homePlaceId,
  ]);
  if (!allowed.has(session.placeId)) return "Lieu introuvable.";
  const fits = await sessionFits(
    person,
    session,
    others,
    travelProvider,
    prefs.bufferMinutes,
    timeZone,
  );
  return fits ? null : "Ce moment n'est pas libre (ou le trajet ne laisse pas le temps).";
}

/** Une séance acceptée, telle qu'enregistrée. */
export interface AcceptedStudySession extends StudySession {
  id: string;
  /** Déplaçable : l'app propose de la replacer quand autre chose tombe dessus. */
  movable: boolean;
}

/**
 * Séances acceptées et déplaçables en conflit : à venir (pas finies), et qui ne tiennent plus
 * dans l'horaire (un plan de groupe, un cours ajouté ou un trajet tombe dessus). Les autres
 * séances acceptées comptent comme occupées. Renvoie leurs identifiants.
 */
export async function findStudyConflicts(
  person: Person,
  accepted: readonly AcceptedStudySession[],
  travelProvider: TravelTimeProvider,
  bufferMinutes: number,
  now: Date,
  timeZone: string = TIME_ZONE,
): Promise<string[]> {
  const travel = memoizeTravel(travelProvider);
  const out: string[] = [];
  for (const s of accepted) {
    if (!s.movable || s.end.getTime() <= now.getTime()) continue;
    const others = accepted.filter((o) => o.id !== s.id);
    if (!(await sessionFits(person, s, others, travel, bufferMinutes, timeZone))) out.push(s.id);
  }
  return out;
}

/** Nouvelle place d'une séance acceptée. */
export interface StudyMove {
  id: string;
  session: StudySession;
}

/**
 * Replace des séances acceptées en conflit : chacune est déplacée au moment libre le plus
 * proche de son heure d'origine, avant son échéance, avec les mêmes règles que le
 * planificateur (lieu, trajets, pause, maximum par jour, soirées). Même durée si possible,
 * sinon la plus longue possible (au moins la durée minimale). Une séance qui ne trouve pas de
 * place donne un avertissement. Rien n'est enregistré : ce sont des propositions.
 */
export async function rescheduleStudySessions(
  person: Person,
  deadlines: readonly Deadline[],
  toMove: readonly AcceptedStudySession[],
  keep: readonly StudySession[],
  prefs: StudyPreferences,
  travelProvider: TravelTimeProvider,
  now: Date,
  options: Omit<StudyPlanOptions, "accepted"> = {},
): Promise<{ moves: StudyMove[]; warnings: StudyWarning[] }> {
  const ctx = new StudyContext(
    person,
    prefs,
    travelProvider,
    now,
    keep,
    options.studyPlaceIds,
    options.timeZone ?? TIME_ZONE,
  );
  const byId = new Map(deadlines.map((d) => [d.id, d]));
  const moves: StudyMove[] = [];
  const warnings: StudyWarning[] = [];
  const sorted = [...toMove].sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const s of sorted) {
    const deadline = byId.get(s.deadlineId);
    if (!deadline || deadline.dueAt.getTime() <= now.getTime()) continue;
    const dueDay = ctx.localDay(deadline.dueAt);
    const wanted = Math.min(
      prefs.maxSessionMinutes,
      Math.max(prefs.minSessionMinutes, floorMinutes(len(s))),
    );
    let best: { session: StudySession; score: number } | null = null;
    for (const day of ctx.today <= dueDay ? eachDay(ctx.today, dueDay) : []) {
      for (const iv of await ctx.usable(day, ctx.endLimit(day, deadline))) {
        // Début le plus proche de l'heure d'origine, dans l'intervalle.
        const latest = addMinutesTo(iv.end, -prefs.minSessionMinutes);
        if (latest < iv.start) continue;
        let start = floorStep(
          new Date(Math.min(Math.max(s.start.getTime(), iv.start.getTime()), latest.getTime())),
        );
        if (start < iv.start) start = ceilStep(iv.start);
        const length = ctx.allowedLength(day, start, len({ start, end: iv.end }), wanted);
        if (length === 0) continue;
        // Préférence : même durée, puis le plus près de l'heure d'origine.
        const score =
          Math.abs(start.getTime() - s.start.getTime()) / MS_PER_MINUTE + (wanted - length) * 60;
        if (!best || score < best.score) {
          best = {
            session: {
              deadlineId: s.deadlineId,
              start,
              end: addMinutesTo(start, length),
              placeId: iv.placeId,
              kind: s.kind,
            },
            score,
          };
        }
      }
    }
    if (best) {
      ctx.sessions.push(best.session);
      moves.push({ id: s.id, session: best.session });
    } else {
      warnings.push({
        kind: "missing",
        deadlineId: s.deadlineId,
        missingMinutes: len(s),
        message: `Pas de moment libre pour replacer une séance avant ${deadlineLabel(deadline)}.`,
      });
    }
  }
  return { moves, warnings };
}
