/**
 * Revue de sécurité (segments 13 et 14) : « Replanifier » reste borné même si quelqu'un écrit
 * des centaines de séances qui se chevauchent par l'API REST.
 */
import { describe, expect, it } from "vitest";

import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import { MAX_REPLAN_SESSIONS, replanMyConflicts, type StudyStore } from "@/lib/study/service";

const ME = "00000000-0000-4000-8000-00000000000a";
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const NOW = new Date("2026-11-03T15:00:00Z");

/** `n` séances acceptées qui se chevauchent (même heure, 3 par jour), 10 échéances. */
function store(n: number): StudyStore {
  const home = { id: uid(1), owner_id: ME, name: "Maison", lat: 45.5, lng: -73.5 };
  const deadlines = Array.from({ length: 10 }, (_, i) => ({
    id: uid(100 + i),
    kind: "exam" as const,
    course: `Cours ${i}`,
    due_at: new Date(NOW.getTime() + (60 + i * 30) * 86_400_000).toISOString(),
    estimated_hours: 20,
    difficulty: 2,
  }));
  const day = (k: number) =>
    new Date(NOW.getTime() + (1 + Math.floor(k / 3)) * 86_400_000).toISOString().slice(0, 10);
  const blocks = Array.from({ length: n }, (_, k) => ({
    id: uid(50_000 + k),
    owner_id: ME,
    title: "Étude : Cours 0",
    place_id: null,
    start_time: "10:00:00",
    end_time: "11:00:00",
    weekday: null,
    valid_from: day(k),
    valid_until: null,
    source: "study" as const,
    deadline_id: deadlines[k % 10].id,
    movable: true,
  }));
  return {
    profile: async () => ({
      ok: true,
      value: { id: ME, display_name: "A", travel_mode: "transit", home_place_id: home.id },
    }),
    places: async () => ({ ok: true, value: [home] }),
    placesByIds: async () => ({ ok: true, value: [] }),
    blocks: async () => ({ ok: true, value: blocks }),
    deadlines: async () => ({ ok: true, value: deadlines }),
    preferences: async () => ({ ok: true, value: null }),
  };
}

const deps = () => ({ userId: ME, now: NOW, travel: new EstimatedTravelProvider() });

describe("Replanifier : coût borné (revue)", () => {
  it(`300 séances en conflit : au plus ${MAX_REPLAN_SESSIONS} replacées, avec un avertissement`, async () => {
    const t = performance.now();
    const r = await replanMyConflicts(store(300), deps());
    const ms = performance.now() - t;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sessions.length).toBeLessThanOrEqual(MAX_REPLAN_SESSIONS);
    expect(r.value.sessions.length).toBeGreaterThan(0);
    expect(r.value.warnings.at(-1)).toMatch(/autres séances en conflit : accepte ces propositions/);
    expect(ms).toBeLessThan(3000);
  });

  it(`au plus ${MAX_REPLAN_SESSIONS} conflits : toutes replacées, sans avertissement de plus`, async () => {
    const r = await replanMyConflicts(store(12), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sessions.length).toBeGreaterThan(0);
    expect(r.value.warnings.some((w) => /autres? séances? en conflit/.test(w))).toBe(false);
  });
});
