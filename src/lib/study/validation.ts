/**
 * Planificateur d'étude (segment 14) : validation des formulaires et des séances envoyées par
 * le navigateur (fonctions pures, testées). La BD refait les contrôles (contraintes et
 * triggers de la migration 0011) : la clé « anon » est publique.
 */
import { validateUuid } from "@/lib/groups/validation";
import { cleanText, type Result } from "@/lib/places/validation";
import {
  assertStudyPreferences,
  DEFAULT_STUDY_PREFERENCES,
  STUDY_STEP_MINUTES,
} from "@/lib/scheduling/studyPlanner";
import { zonedTime } from "@/lib/scheduling/time";
import type {
  DeadlineKind,
  Difficulty,
  StudyPreferences,
  StudySessionKind,
} from "@/lib/scheduling/types";
import { parseClock } from "@/lib/scheduling/weeklyBlocks";

/** Longueur maximale d'un nom de cours (contrainte `deadlines_course_length`). */
export const COURSE_MAX = 80;
/** Heures estimées permises (par demi-heure). */
export const ESTIMATED_HOURS = { min: 0.5, max: 60 } as const;
/** Une échéance est dans l'année qui vient (le trigger de la BD accepte 366 jours). */
export const DEADLINE_MAX_DAYS = 365;
/** Séances acceptées ou vérifiées d'un coup, au plus. */
export const MAX_SESSIONS_PER_REQUEST = 100;

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  exam: "Examen",
  assignment: "Travail",
};
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "Facile",
  2: "Moyen",
  3: "Difficile",
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Échéance validée, prête à écrire. */
export interface DeadlineFormValue {
  kind: DeadlineKind;
  course: string;
  dueAt: Date;
  estimatedHours: number | null;
  difficulty: Difficulty;
}

/**
 * Formulaire « Ajouter un examen ou un travail » : type, cours (1 à 80 caractères sur une
 * ligne), jour et heure (heure locale, dans l'année qui vient, pas passés), heures estimées
 * (vide, ou 0,5 à 60 par demi-heure) et difficulté (1 à 3).
 */
export function validateDeadlineForm(raw: unknown, now: Date): Result<DeadlineFormValue> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Formulaire invalide." };
  const r = raw as Record<string, unknown>;

  if (r.kind !== "exam" && r.kind !== "assignment") {
    return { ok: false, error: "Choisis examen ou travail." };
  }
  if (typeof r.course !== "string") return { ok: false, error: "Le cours est manquant." };
  if (CONTROL_CHARS.test(r.course)) {
    return { ok: false, error: "Le nom du cours contient des caractères invalides." };
  }
  const course = cleanText(r.course);
  if (course.length === 0) return { ok: false, error: "Écris le nom du cours." };
  if (course.length > COURSE_MAX) {
    return {
      ok: false,
      error: `Le nom du cours est trop long (${COURSE_MAX} caractères au maximum).`,
    };
  }

  if (typeof r.date !== "string" || !DAY_RE.test(r.date)) {
    return { ok: false, error: "Choisis la date." };
  }
  if (typeof r.time !== "string" || parseClock(r.time) === null || r.time === "24:00") {
    return { ok: false, error: "Choisis l'heure." };
  }
  let dueAt: Date;
  try {
    dueAt = zonedTime(r.date, r.time);
  } catch {
    return { ok: false, error: "Date invalide." };
  }
  if (dueAt.getTime() <= now.getTime()) {
    return { ok: false, error: "Cette date est déjà passée." };
  }
  if (dueAt.getTime() > now.getTime() + DEADLINE_MAX_DAYS * 86_400_000) {
    return { ok: false, error: "Choisis une date dans l'année qui vient." };
  }

  let estimatedHours: number | null = null;
  if (r.hours !== undefined && r.hours !== null && r.hours !== "") {
    const h = typeof r.hours === "number" ? r.hours : Number(String(r.hours).replace(",", "."));
    if (
      !Number.isFinite(h) ||
      h < ESTIMATED_HOURS.min ||
      h > ESTIMATED_HOURS.max ||
      Math.round(h * 2) !== h * 2
    ) {
      return {
        ok: false,
        error: "Les heures estimées vont de 0,5 à 60, par demi-heure (ou laisse vide).",
      };
    }
    estimatedHours = h;
  }

  const difficulty = Number(r.difficulty ?? 2);
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) {
    return { ok: false, error: "Difficulté invalide." };
  }
  return { ok: true, value: { kind: r.kind, course, dueAt, estimatedHours, difficulty } };
}

/** Choix proposés dans /profil (minutes). */
export const SESSION_LENGTH_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180, 240] as const;
export const DAY_MAX_CHOICES = [60, 90, 120, 150, 180, 240, 300, 360, 480, 600] as const;
export const BREAK_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60] as const;
export const KEEP_FREE_CHOICES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

/**
 * Formulaire des préférences d'étude (/profil). Champs : `minSession`, `maxSession`,
 * `maxPerDay`, `breakMinutes`, `keepFreePercent` (nombres), `studyStart`, `studyEnd` (« HH:mm »)
 * et `eveCutoff` (« HH:mm » ou vide = pas de limite).
 */
export function validateStudyPreferencesForm(raw: unknown): Result<StudyPreferences> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Réglage invalide." };
  const r = raw as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
  const clock = (v: unknown) => (typeof v === "string" && parseClock(v) !== null ? v : null);

  const minSession = int(r.minSession);
  const maxSession = int(r.maxSession);
  if (
    !(minSession >= 30 && minSession <= 120) ||
    !(maxSession >= 30 && maxSession <= 240) ||
    minSession % STUDY_STEP_MINUTES !== 0 ||
    maxSession % STUDY_STEP_MINUTES !== 0
  ) {
    return { ok: false, error: "Durée de séance invalide." };
  }
  if (maxSession < minSession) {
    return { ok: false, error: "La durée maximale doit être au moins la durée minimale." };
  }
  const maxPerDay = int(r.maxPerDay);
  if (!(maxPerDay >= 30 && maxPerDay <= 600) || maxPerDay % STUDY_STEP_MINUTES !== 0) {
    return { ok: false, error: "Maximum par jour invalide." };
  }
  if (maxPerDay < minSession) {
    return { ok: false, error: "Le maximum par jour doit permettre au moins une séance." };
  }
  const breakMinutes = int(r.breakMinutes);
  if (!(breakMinutes >= 0 && breakMinutes <= 60)) return { ok: false, error: "Pause invalide." };
  const keep = int(r.keepFreePercent);
  if (!(keep >= 0 && keep <= 90)) return { ok: false, error: "Part gardée libre invalide." };
  const start = clock(r.studyStart);
  const end = clock(r.studyEnd);
  if (!start || !end) return { ok: false, error: "Heures d'étude invalides." };
  if ((parseClock(end) ?? 0) - (parseClock(start) ?? 0) < minSession) {
    return { ok: false, error: "Les heures d'étude doivent laisser le temps d'une séance." };
  }
  let eveCutoff: string | null = null;
  if (r.eveCutoff !== "" && r.eveCutoff !== null && r.eveCutoff !== undefined) {
    eveCutoff = clock(r.eveCutoff);
    if (!eveCutoff) return { ok: false, error: "Heure limite de la veille invalide." };
  }
  const prefs: StudyPreferences = {
    ...DEFAULT_STUDY_PREFERENCES,
    minSessionMinutes: minSession,
    maxSessionMinutes: maxSession,
    maxStudyMinutesPerDay: maxPerDay,
    breakMinutes,
    studyHours: { start, end },
    eveCutoff,
    keepFreeRatio: keep / 100,
  };
  try {
    assertStudyPreferences(prefs);
  } catch {
    return { ok: false, error: "Réglage invalide." };
  }
  return { ok: true, value: prefs };
}

/** Séance envoyée par le navigateur (proposée, déplacée, ou remplaçante d'une séance). */
export interface SessionInput {
  /** Clé de la proposition côté navigateur (pour rattacher une erreur). */
  key: string;
  deadlineId: string;
  start: Date;
  end: Date;
  placeId: string;
  kind: StudySessionKind;
  /** Séance acceptée que celle-ci remplace (replanification), sinon nul. */
  replacesId: string | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const KEY_RE = /^[\w:.-]{1,120}$/;

/** Une séance envoyée par le navigateur. */
export function validateSessionInput(raw: unknown): Result<SessionInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Séance invalide." };
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== "string" || !KEY_RE.test(r.key)) {
    return { ok: false, error: "Séance invalide." };
  }
  const deadline = validateUuid(r.deadlineId);
  if (!deadline.ok) return { ok: false, error: "Échéance introuvable." };
  const place = validateUuid(r.placeId);
  if (!place.ok) return { ok: false, error: "Lieu introuvable." };
  if (typeof r.start !== "string" || typeof r.end !== "string") {
    return { ok: false, error: "Heure invalide." };
  }
  if (!ISO_RE.test(r.start) || !ISO_RE.test(r.end)) return { ok: false, error: "Heure invalide." };
  const start = new Date(r.start);
  const end = new Date(r.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return { ok: false, error: "Heure invalide." };
  }
  if (r.kind !== "study" && r.kind !== "review") return { ok: false, error: "Séance invalide." };
  let replacesId: string | null = null;
  if (r.replacesId !== null && r.replacesId !== undefined) {
    const rep = validateUuid(r.replacesId);
    if (!rep.ok) return { ok: false, error: "Séance à remplacer introuvable." };
    replacesId = rep.value;
  }
  return {
    ok: true,
    value: {
      key: r.key,
      deadlineId: deadline.value,
      start,
      end,
      placeId: place.value,
      kind: r.kind,
      replacesId,
    },
  };
}

/** Liste de séances (1 à 100, clés et séances remplacées sans doublon). */
export function validateSessionList(raw: unknown): Result<SessionInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Aucune séance." };
  if (raw.length > MAX_SESSIONS_PER_REQUEST) {
    return { ok: false, error: `Au plus ${MAX_SESSIONS_PER_REQUEST} séances à la fois.` };
  }
  const out: SessionInput[] = [];
  const keys = new Set<string>();
  const replaced = new Set<string>();
  for (const item of raw) {
    const s = validateSessionInput(item);
    if (!s.ok) return s;
    if (keys.has(s.value.key)) return { ok: false, error: "Séance en double." };
    keys.add(s.value.key);
    if (s.value.replacesId) {
      if (replaced.has(s.value.replacesId)) return { ok: false, error: "Séance en double." };
      replaced.add(s.value.replacesId);
    }
    out.push(s.value);
  }
  return { ok: true, value: out };
}
