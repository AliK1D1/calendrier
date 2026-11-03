/** Segment 14 : validation des formulaires et des séances, conversions des lignes d'étude. */
import { describe, expect, it } from "vitest";

import {
  fromStudyPreferences,
  studySessionTitle,
  studySessionToRow,
  toAcceptedSession,
  toDeadline,
  toStudyPreferences,
  type StudyBlockInput,
} from "@/lib/db/convert";
import { DEFAULT_STUDY_PREFERENCES } from "@/lib/scheduling/studyPlanner";
import { zonedTime } from "@/lib/scheduling/time";

import {
  MAX_SESSIONS_PER_REQUEST,
  validateDeadlineForm,
  validateSessionInput,
  validateSessionList,
  validateStudyPreferencesForm,
} from "../validation";

const NOW = zonedTime("2025-09-15", "07:00");
const D = "00000000-0000-4000-8000-0000000000d1";
const P = "00000000-0000-4000-8000-0000000000e1";
const S = "00000000-0000-4000-8000-0000000000f1";

const deadline = (extra: Record<string, unknown> = {}) => ({
  kind: "exam",
  course: "Chimie",
  date: "2025-09-19",
  time: "13:00",
  hours: "",
  difficulty: 2,
  ...extra,
});

describe("validateDeadlineForm", () => {
  it("accepte un examen valide (heure locale de Montréal)", () => {
    const r = validateDeadlineForm(deadline({ course: "  Chimie   organique " }), NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "exam",
        course: "Chimie organique",
        dueAt: zonedTime("2025-09-19", "13:00"),
        estimatedHours: null,
        difficulty: 2,
      },
    });
  });

  it("heures estimées : 0,5 à 60 par demi-heure, virgule acceptée", () => {
    const ok = validateDeadlineForm(deadline({ hours: "2,5" }), NOW);
    expect(ok.ok && ok.value.estimatedHours).toBe(2.5);
    for (const hours of ["0", "0.25", "60.5", "abc", -1, 1.2, Infinity]) {
      expect(validateDeadlineForm(deadline({ hours }), NOW).ok).toBe(false);
    }
  });

  it("refuse cours vide, trop long, avec caractères de contrôle", () => {
    expect(validateDeadlineForm(deadline({ course: "   " }), NOW).ok).toBe(false);
    expect(validateDeadlineForm(deadline({ course: "x".repeat(81) }), NOW).ok).toBe(false);
    expect(validateDeadlineForm(deadline({ course: "x".repeat(80) }), NOW).ok).toBe(true);
    for (const c of ["a\nb", "a\u0000b", "a\u0085b", "a\u007fb"]) {
      expect(validateDeadlineForm(deadline({ course: c }), NOW)).toEqual({
        ok: false,
        error: "Le nom du cours contient des caractères invalides.",
      });
    }
    expect(validateDeadlineForm(deadline({ course: 42 }), NOW).ok).toBe(false);
  });

  it("dates bornées : pas passée, au plus un an", () => {
    expect(validateDeadlineForm(deadline({ date: "2025-09-15", time: "06:00" }), NOW).ok).toBe(
      false,
    );
    expect(validateDeadlineForm(deadline({ date: "2026-09-15", time: "06:00" }), NOW).ok).toBe(
      true,
    );
    expect(validateDeadlineForm(deadline({ date: "2026-09-16", time: "08:00" }), NOW).ok).toBe(
      false,
    );
    for (const bad of [{ date: "19/09/2025" }, { time: "25:00" }, { time: "24:00" }, { date: 1 }]) {
      expect(validateDeadlineForm(deadline(bad), NOW).ok).toBe(false);
    }
  });

  it("type et difficulté", () => {
    expect(validateDeadlineForm(deadline({ kind: "quiz" }), NOW).ok).toBe(false);
    expect(validateDeadlineForm(deadline({ difficulty: 4 }), NOW).ok).toBe(false);
    expect(validateDeadlineForm(deadline({ difficulty: "3" }), NOW).ok).toBe(true);
    expect(validateDeadlineForm(null, NOW).ok).toBe(false);
  });
});

describe("validateStudyPreferencesForm", () => {
  const form = (extra: Record<string, unknown> = {}) => ({
    minSession: 45,
    maxSession: 120,
    maxPerDay: 180,
    breakMinutes: 15,
    keepFreePercent: 30,
    studyStart: "08:00",
    studyEnd: "22:00",
    eveCutoff: "21:00",
    ...extra,
  });

  it("donne des préférences complètes, et l'aller-retour vers la BD les garde", () => {
    const r = validateStudyPreferencesForm(form({ eveCutoff: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eveCutoff).toBeNull();
    expect(r.value.keepFreeRatio).toBe(0.3);
    expect(toStudyPreferences(fromStudyPreferences(r.value))).toEqual(r.value);
  });

  it("refuse les valeurs hors bornes ou incohérentes", () => {
    for (const bad of [
      { minSession: 20 },
      { minSession: 50 },
      { maxSession: 300 },
      { minSession: 90, maxSession: 60 },
      { maxPerDay: 700 },
      { maxPerDay: 30 },
      { breakMinutes: 90 },
      { keepFreePercent: 95 },
      { studyStart: "21:30", studyEnd: "22:00" },
      { studyStart: "8h" },
      { eveCutoff: "nuit" },
      { minSession: "45" },
    ]) {
      expect(validateStudyPreferencesForm(form(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("toStudyPreferences : valeurs par défaut si jamais réglées ou incohérentes", () => {
    expect(toStudyPreferences(null)).toEqual(DEFAULT_STUDY_PREFERENCES);
    const bad = {
      ...fromStudyPreferences(DEFAULT_STUDY_PREFERENCES),
      min_session_minutes: 200,
    };
    expect(toStudyPreferences(bad)).toEqual(DEFAULT_STUDY_PREFERENCES);
  });
});

describe("validateSessionInput / validateSessionList", () => {
  const session = (extra: Record<string, unknown> = {}) => ({
    key: "abc-1",
    deadlineId: D,
    start: "2025-09-16T14:00:00.000Z",
    end: "2025-09-16T15:00:00.000Z",
    placeId: P,
    kind: "study",
    replacesId: null,
    ...extra,
  });

  it("accepte une séance bien formée", () => {
    const r = validateSessionInput(session());
    expect(r.ok && r.value.start.toISOString()).toBe("2025-09-16T14:00:00.000Z");
  });

  it("refuse identifiants, heures, type ou clé invalides", () => {
    for (const bad of [
      { deadlineId: "x" },
      { placeId: "'; drop table" },
      { start: "demain" },
      { end: "2025-09-16T13:00:00.000Z" },
      { kind: "party" },
      { key: "a b" },
      { key: "x".repeat(121) },
      { replacesId: "nope" },
    ]) {
      expect(validateSessionInput(session(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("liste : 1 à 100 séances, sans clé ni séance remplacée en double", () => {
    expect(validateSessionList([]).ok).toBe(false);
    expect(validateSessionList("x").ok).toBe(false);
    const many = Array.from({ length: MAX_SESSIONS_PER_REQUEST + 1 }, (_, i) =>
      session({ key: `k${i}` }),
    );
    expect(validateSessionList(many).ok).toBe(false);
    expect(validateSessionList(many.slice(0, MAX_SESSIONS_PER_REQUEST)).ok).toBe(true);
    expect(validateSessionList([session(), session()])).toEqual({
      ok: false,
      error: "Séance en double.",
    });
    expect(
      validateSessionList([
        session({ key: "a", replacesId: S }),
        session({ key: "b", replacesId: S }),
      ]).ok,
    ).toBe(false);
  });
});

describe("conversions des séances", () => {
  it("toDeadline", () => {
    expect(
      toDeadline({
        id: D,
        kind: "assignment",
        course: "Anglais",
        due_at: "2025-09-19T17:00:00+00:00",
        estimated_hours: 2.5,
        difficulty: 1,
      }),
    ).toEqual({
      id: D,
      kind: "assignment",
      course: "Anglais",
      dueAt: new Date("2025-09-19T17:00:00Z"),
      estimatedHours: 2.5,
      difficulty: 1,
    });
  });

  it("séance ↔ bloc : heures locales, minuit = 24:00, pas de traversée de minuit", () => {
    const start = zonedTime("2025-09-16", "22:30");
    const end = zonedTime("2025-09-16", "24:00");
    const row = studySessionToRow({ start, end, placeId: P }, studySessionTitle("study", "Chimie"));
    expect(row).toEqual({
      title: "Étude : Chimie",
      place_id: P,
      start_time: "22:30",
      end_time: "24:00",
      weekday: null,
      valid_from: "2025-09-16",
      valid_until: "2025-09-16",
    });
    expect(() =>
      studySessionToRow(
        { start, end: zonedTime("2025-09-17", "00:30"), placeId: P },
        "Étude : Chimie",
      ),
    ).toThrow();

    const block: StudyBlockInput = {
      id: S,
      owner_id: D,
      ...row,
      title: studySessionTitle("review", "Chimie"),
      start_time: "22:30:00",
      end_time: "24:00:00",
      source: "study",
      deadline_id: D,
      movable: true,
    };
    expect(toAcceptedSession(block, "home")).toEqual({
      id: S,
      deadlineId: D,
      start,
      end,
      placeId: P,
      kind: "review",
      movable: true,
    });
    expect(toAcceptedSession({ ...block, source: "manual" }, "home")).toBeNull();
    expect(toAcceptedSession({ ...block, place_id: null }, "home")?.placeId).toBe("home");
  });

  it("titre tronqué à 100 caractères (limite des blocs)", () => {
    expect(studySessionTitle("study", "x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
