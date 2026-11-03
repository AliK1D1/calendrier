/**
 * Segment 14 : planificateur d'étude de bout en bout sur PGlite, avec un magasin qui fait les
 * mêmes lectures que src/lib/study/supabaseStore.ts au nom de la personne connectée (RLS), et
 * les mêmes écritures que src/app/etude/actions.ts. Vérifie : planifier n'écrit rien, accepter
 * écrit des blocs 'study', le déplacement est revalidé, l'échéance ou le lieu d'un autre est
 * refusé, un plan de groupe sur une séance déplaçable donne un conflit puis une replanification,
 * et une séance acceptée compte comme occupée (« Occupé ») dans la recherche de groupe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { searchGroupMeetups, type MeetupStore } from "@/lib/meetups/search";
import { localDay } from "@/lib/scheduling/period";
import { addMinutesTo, zonedTime } from "@/lib/scheduling/time";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import { shiftDay, weekdayOf } from "@/lib/scheduling/weeklyBlocks";
import {
  checkMovedSession,
  myStudyConflicts,
  planMyStudy,
  prepareAcceptance,
  replanMyConflicts,
  type SessionView,
  type StudyStore,
} from "@/lib/study/service";
import type { SessionInput } from "@/lib/study/validation";

import type {
  BusyBlockInput,
  DeadlineInput,
  PlaceInput,
  ProfileInput,
  StudyBlockInput,
  StudyPreferencesInput,
} from "../convert";
import { FAKE_SUPABASE, asUser } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;
const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);
async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/**
 * Lundi prochain, 7 h (heure de Montréal) : les dates restent dans les bornes de la base
 * (échéance dans l'année qui vient, comparée au vrai now()).
 */
const MONDAY = (() => {
  let d = shiftDay(localDay(new Date()), 1);
  while (weekdayOf(d) !== 1) d = shiftDay(d, 1);
  return d;
})();
const NOW = zonedTime(MONDAY, "07:00");
const day = (n: number) => shiftDay(MONDAY, n);
const deps = (uid: string) => ({ userId: uid, now: NOW, travel: new EstimatedTravelProvider() });

/** Mêmes lectures que supabaseStudyStore, au nom de `uid`. */
function pgliteStudyStore(uid: string): StudyStore {
  const read = async <T>(sql: string, params: unknown[] = []) => {
    try {
      return { ok: true as const, value: await as(uid, () => rows<T>(sql, params)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  };
  const BLOCK_COLS = `id, owner_id, title, place_id, start_time::text, end_time::text, weekday,
    valid_from::text, valid_until::text`;
  return {
    async profile() {
      const r = await read<ProfileInput>(
        `SELECT id, display_name, travel_mode, home_place_id, unavailable_before::text,
                unavailable_after::text FROM profiles WHERE id = $1`,
        [uid],
      );
      return r.ok ? { ok: true, value: r.value[0] ?? null } : r;
    },
    places: () =>
      read<PlaceInput>(
        "SELECT id, owner_id, name, lat, lng FROM places WHERE owner_id = $1 AND group_id IS NULL",
        [uid],
      ),
    placesByIds: (ids) =>
      read<PlaceInput>(
        "SELECT id, owner_id, name, lat, lng FROM places WHERE id = ANY($1::uuid[])",
        [ids],
      ),
    blocks: () =>
      read<StudyBlockInput>(
        `SELECT ${BLOCK_COLS}, source, deadline_id, movable FROM busy_blocks WHERE owner_id = $1`,
        [uid],
      ),
    deadlines: () =>
      read<DeadlineInput>(
        `SELECT id, kind, course, due_at::text, estimated_hours::float8 AS estimated_hours, difficulty
         FROM deadlines WHERE owner_id = $1 ORDER BY due_at`,
        [uid],
      ),
    async preferences() {
      const r = await read<StudyPreferencesInput>(
        `SELECT min_session_minutes, max_session_minutes, max_minutes_per_day, break_minutes,
                study_start::text, study_end::text, eve_cutoff::text, keep_free_percent
         FROM study_preferences WHERE owner_id = $1`,
        [uid],
      );
      return r.ok ? { ok: true, value: r.value[0] ?? null } : r;
    },
  };
}

/** Même écriture que l'action « accepterSeances » (au nom de `uid`, RLS). */
async function accept(uid: string, inputs: SessionInput[]) {
  const plan = await prepareAcceptance(pgliteStudyStore(uid), inputs, deps(uid));
  if (!plan.ok) return plan;
  await as(uid, async () => {
    for (const row of plan.value.inserts) {
      await rows(
        `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from,
           valid_until, deadline_id, source, movable)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'study', true)`,
        [
          row.title,
          row.place_id,
          row.start_time,
          row.end_time,
          row.valid_from,
          row.valid_until,
          row.deadline_id,
        ],
      );
    }
    for (const u of plan.value.updates) {
      await rows(
        `UPDATE busy_blocks SET title = $2, place_id = $3, start_time = $4, end_time = $5,
           valid_from = $6, valid_until = $7
         WHERE id = $1 AND owner_id = $8 AND source = 'study'`,
        [
          u.id,
          u.row.title,
          u.row.place_id,
          u.row.start_time,
          u.row.end_time,
          u.row.valid_from,
          u.row.valid_until,
          uid,
        ],
      );
    }
  });
  return { ok: true as const, count: plan.value.inserts.length + plan.value.updates.length };
}

/**
 * Un plan de groupe au même moment qu'une séance : B le propose, A l'accepte (la base écrit
 * le bloc 'meetup' de A, comme dans l'app).
 */
async function meetupOn(s: { valid_from: string; start_time: string; end_time: string }) {
  const starts = zonedTime(s.valid_from, s.start_time.slice(0, 5));
  const ends = zonedTime(s.valid_from, s.end_time.slice(0, 5));
  const [{ id }] = await as(B, () =>
    rows<{ id: string }>("SELECT public.propose_meetup($1, $2, $3, 'Souper') AS id", [
      G,
      starts.toISOString(),
      ends.toISOString(),
    ]),
  );
  await as(A, () => rows("SELECT public.respond_to_meetup($1, true)", [id]));
}

/** Ce que le navigateur renvoie pour une séance proposée. */
const toInput = (s: SessionView): SessionInput => ({
  key: s.key,
  deadlineId: s.deadlineId,
  start: new Date(s.start),
  end: new Date(s.end),
  placeId: s.placeId,
  kind: s.kind,
  replacesId: s.replacesId,
});

const countBlocks = async () =>
  Number((await rows<{ n: number }>("SELECT count(*)::int AS n FROM busy_blocks"))[0].n);

let homeA: string;
let libA: string;
let homeB: string;
let deadlineA: string;
let deadlineB: string;
let G: string;

/** Une personne : maison, bibliothèque, cours du lundi au vendredi de 9 h à 12 h. */
async function seed(uid: string, name: string): Promise<{ home: string; lib: string }> {
  return as(uid, async () => {
    const [home] = await rows<{ id: string }>(
      "INSERT INTO places (name, lat, lng) VALUES ('Maison', 45.52, -73.58) RETURNING id",
    );
    const [lib] = await rows<{ id: string }>(
      "INSERT INTO places (name, lat, lng) VALUES ('Bibliothèque', 45.505, -73.577) RETURNING id",
    );
    await rows("UPDATE profiles SET display_name = $2, home_place_id = $3 WHERE id = $1", [
      uid,
      name,
      home.id,
    ]);
    for (let wd = 1; wd <= 5; wd++) {
      await rows(
        `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ('Cours', $1, '09:00', '12:00', $2, $3, $4)`,
        [lib.id, wd, day(-7), day(60)],
      );
    }
    return { home: home.id, lib: lib.id };
  });
}

async function addDeadline(uid: string, course: string, dueDay: string, hours: number) {
  const [r] = await as(uid, () =>
    rows<{ id: string }>(
      `INSERT INTO deadlines (kind, course, due_at, estimated_hours, difficulty)
       VALUES ('exam', $1, $2, $3, 2) RETURNING id`,
      [course, zonedTime(dueDay, "13:00").toISOString(), hours],
    ),
  );
  return r.id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(FAKE_SUPABASE);
  await db.exec(SETUP_SQL);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("RESET ROLE; DELETE FROM auth.users; DELETE FROM public.groups;");
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ($1, 'ali@example.com', '{"full_name": "Ali"}'),
       ($2, 'sam@example.com', '{"full_name": "Sam"}')`,
    [A, B],
  );
  ({ home: homeA, lib: libA } = await seed(A, "Ali"));
  ({ home: homeB } = await seed(B, "Sam"));
  // Examen de chimie vendredi 13 h, 4 h d'étude.
  deadlineA = await addDeadline(A, "Chimie", day(4), 4);
  deadlineB = await addDeadline(B, "Physique", day(4), 4);
  const [g] = await as(A, () => rows<{ id: string }>("SELECT public.create_group('Gang') AS id"));
  G = g.id;
  const [{ invite_code }] = await rows<{ invite_code: string }>(
    "SELECT invite_code FROM groups WHERE id = $1",
    [G],
  );
  await as(B, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
});

async function plan(uid = A) {
  const r = await planMyStudy(pgliteStudyStore(uid), deps(uid));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("Planifier mon étude", () => {
  it("propose des séances avant l'échéance sans rien écrire", async () => {
    const before = await countBlocks();
    const p = await plan();
    expect(p.mode).toBe("plan");
    expect(p.warnings).toEqual([]);
    expect(p.sessions.length).toBeGreaterThan(0);
    const due = zonedTime(day(4), "13:00").getTime();
    const total = p.sessions.reduce((t, s) => t + (s.endMinute - s.startMinute), 0);
    expect(total).toBe(4 * 60);
    for (const s of p.sessions) {
      expect(s.deadlineId).toBe(deadlineA);
      expect(Date.parse(s.end)).toBeLessThanOrEqual(due);
      expect(Date.parse(s.start)).toBeGreaterThanOrEqual(NOW.getTime());
      expect([homeA, libA]).toContain(s.placeId);
      // Jamais pendant le cours (9 h à 12 h, lundi au vendredi).
      expect(s.endMinute <= 9 * 60 || s.startMinute >= 12 * 60).toBe(true);
      expect(s.title).toBe(s.kind === "review" ? "Révision : Chimie" : "Étude : Chimie");
    }
    expect(await countBlocks()).toBe(before);
  });

  it("sans maison : message clair", async () => {
    await as(A, () => rows("UPDATE profiles SET home_place_id = NULL WHERE id = $1", [A]));
    const r = await planMyStudy(pgliteStudyStore(A), deps(A));
    expect(r).toEqual({
      ok: false,
      error: "Choisis ta maison dans « Mes lieux » avant de planifier ton étude.",
    });
  });

  it("ne voit pas les échéances d'un autre (RLS) : B ne planifie que la sienne", async () => {
    const p = await plan(B);
    expect(new Set(p.sessions.map((s) => s.deadlineId))).toEqual(new Set([deadlineB]));
  });
});

describe("Accepter", () => {
  it("écrit des blocs 'study' déplaçables, liés à l'échéance ; un nouveau calcul n'en ajoute pas", async () => {
    const p = await plan();
    const r = await accept(A, p.sessions.map(toInput));
    expect(r).toEqual({ ok: true, count: p.sessions.length });
    const written = await as(A, () =>
      rows<{ source: string; deadline_id: string; movable: boolean; title: string }>(
        "SELECT source, deadline_id, movable, title FROM busy_blocks WHERE source = 'study'",
      ),
    );
    expect(written).toHaveLength(p.sessions.length);
    for (const w of written) {
      expect(w).toMatchObject({ source: "study", deadline_id: deadlineA, movable: true });
    }
    const again = await plan();
    expect(again.sessions).toEqual([]);
    // Accepter deux fois la même chose : refusé (le moment n'est plus libre), rien d'écrit.
    const before = await countBlocks();
    const twice = await accept(A, p.sessions.slice(0, 1).map(toInput));
    expect(twice.ok).toBe(false);
    expect(await countBlocks()).toBe(before);
  });

  it("tout ou rien : une séance invalide dans le lot, rien n'est écrit", async () => {
    const p = await plan();
    const bad = { ...toInput(p.sessions[0]), key: "bad" };
    bad.start = zonedTime(day(1), "10:00"); // pendant le cours
    bad.end = zonedTime(day(1), "11:00");
    const before = await countBlocks();
    const r = await accept(A, [...p.sessions.slice(1).map(toInput), bad]);
    expect(r).toMatchObject({ ok: false, key: "bad" });
    expect(!r.ok && r.error).toMatch(/pas libre/);
    expect(await countBlocks()).toBe(before);
  });

  it("refuse l'échéance d'un autre, son lieu ou sa séance (même forgés à la main)", async () => {
    const [s] = (await plan()).sessions;
    expect(await accept(A, [{ ...toInput(s), deadlineId: deadlineB }])).toMatchObject({
      ok: false,
      error: "Échéance introuvable.",
    });
    const r = await accept(A, [{ ...toInput(s), placeId: homeB }]);
    expect(!r.ok && r.error).toMatch(/Lieu introuvable/);
    // Séance acceptée de B : A ne peut pas la « remplacer ».
    const [sb] = (await plan(B)).sessions;
    await accept(B, [toInput(sb)]);
    const [{ id: blockB }] = await rows<{ id: string }>(
      "SELECT id FROM busy_blocks WHERE owner_id = $1 AND source = 'study'",
      [B],
    );
    expect(await accept(A, [{ ...toInput(s), replacesId: blockB }])).toMatchObject({
      ok: false,
      error: "Séance introuvable.",
    });
    // Et la base refuse de toute façon un bloc lié à l'échéance de B.
    await expect(
      as(A, () =>
        rows(
          `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source, deadline_id, movable)
           VALUES ('x', '14:00', '15:00', $1, 'study', $2, true)`,
          [day(1), deadlineB],
        ),
      ),
    ).rejects.toThrow(/Échéance introuvable/);
  });
});

describe("Déplacer (glisser) : revalidé par le serveur", () => {
  it("refuse pendant un cours, après l'examen, hors du quart d'heure ou sur une autre proposition", async () => {
    const p = await plan();
    const s = toInput(p.sessions[0]);
    const others = p.sessions.slice(1).map(toInput);
    const check = (start: Date, minutes = 60, extra: Partial<SessionInput> = {}) =>
      checkMovedSession(
        pgliteStudyStore(A),
        { ...s, start, end: addMinutesTo(start, minutes), ...extra },
        others,
        deps(A),
      );
    expect(await check(zonedTime(day(1), "10:00"))).toMatchObject({ ok: false });
    expect(await check(zonedTime(day(5), "15:00"))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/après l'examen de Chimie/),
    });
    expect(await check(zonedTime(day(1), "14:10"))).toMatchObject({
      ok: false,
      error: "Les séances commencent et finissent au quart d'heure.",
    });
    expect(await check(zonedTime(day(1), "14:00"), 300)).toMatchObject({ ok: false });
    // Sur une autre proposition encore affichée (4 h d'étude : au moins deux séances).
    expect(p.sessions.length).toBeGreaterThanOrEqual(2);
    expect(await check(new Date(p.sessions[1].start))).toMatchObject({ ok: false });
    // Un moment vraiment libre (mardi 19 h), sans autres propositions affichées.
    const free = zonedTime(day(1), "19:00");
    const ok = await checkMovedSession(
      pgliteStudyStore(A),
      { ...s, start: free, end: addMinutesTo(free, 60) },
      [],
      deps(A),
    );
    expect(ok).toMatchObject({ ok: true, value: { startMinute: 19 * 60, endMinute: 20 * 60 } });
  });
});

describe("Conflit : un plan de groupe tombe sur une séance déplaçable", () => {
  it("donne « Séance en conflit », puis une nouvelle place, écrite seulement à l'acceptation", async () => {
    const p = await plan();
    await accept(A, p.sessions.map(toInput));
    const [first] = await rows<{
      id: string;
      valid_from: string;
      start_time: string;
      end_time: string;
    }>(
      `SELECT id, valid_from::text, start_time::text, end_time::text FROM busy_blocks
       WHERE owner_id = $1 AND source = 'study' ORDER BY valid_from, start_time LIMIT 1`,
      [A],
    );
    expect((await myStudyConflicts(pgliteStudyStore(A), deps(A))).ok).toBe(true);
    expect(await myStudyConflicts(pgliteStudyStore(A), deps(A))).toEqual({ ok: true, value: [] });

    // Un plan de groupe (bloc 'meetup', écrit par la base comme à l'acceptation d'un plan).
    await meetupOn(first);
    const conflicts = await myStudyConflicts(pgliteStudyStore(A), deps(A));
    expect(conflicts.ok && conflicts.value.map((c) => c.id)).toEqual([first.id]);

    const before = await rows("SELECT * FROM busy_blocks WHERE id = $1", [first.id]);
    const replan = await replanMyConflicts(pgliteStudyStore(A), deps(A));
    if (!replan.ok) throw new Error(replan.error);
    expect(replan.value.mode).toBe("replan");
    expect(replan.value.sessions).toHaveLength(1);
    expect(replan.value.sessions[0].replacesId).toBe(first.id);
    // Rien n'a bougé avant l'acceptation.
    expect(await rows("SELECT * FROM busy_blocks WHERE id = $1", [first.id])).toEqual(before);

    expect(await accept(A, replan.value.sessions.map(toInput))).toEqual({ ok: true, count: 1 });
    expect(await myStudyConflicts(pgliteStudyStore(A), deps(A))).toEqual({ ok: true, value: [] });
    const [moved] = await rows<{ deadline_id: string; movable: boolean }>(
      "SELECT deadline_id, movable FROM busy_blocks WHERE id = $1",
      [first.id],
    );
    expect(moved).toEqual({ deadline_id: deadlineA, movable: true });
  });

  it("une séance non déplaçable n'est jamais signalée", async () => {
    const p = await plan();
    await accept(A, p.sessions.slice(0, 1).map(toInput));
    const [first] = await rows<{
      id: string;
      valid_from: string;
      start_time: string;
      end_time: string;
    }>(
      `SELECT id, valid_from::text, start_time::text, end_time::text FROM busy_blocks
       WHERE owner_id = $1 AND source = 'study'`,
      [A],
    );
    await as(A, () => rows("UPDATE busy_blocks SET movable = false WHERE id = $1", [first.id]));
    await meetupOn(first);
    expect(await myStudyConflicts(pgliteStudyStore(A), deps(A))).toEqual({ ok: true, value: [] });
  });
});

describe("Recherche de groupe : une séance acceptée est « Occupé »", () => {
  it("B voit la séance de A comme « Occupé », et aucune proposition ne tombe dessus", async () => {
    const p = await plan();
    await accept(A, p.sessions.map(toInput));
    const seen = await as(B, () =>
      rows<{ title: string; owner_id: string }>(
        "SELECT title, owner_id FROM public.group_busy_blocks($1) WHERE owner_id = $2",
        [G, A],
      ),
    );
    expect(seen.some((b) => b.title === "Occupé")).toBe(true);
    expect(seen.some((b) => /Chimie/.test(b.title))).toBe(false);

    const read = async <T>(sql: string, params: unknown[]) => {
      try {
        return { ok: true as const, value: await as(B, () => rows<T>(sql, params)) };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    };
    const store: MeetupStore = {
      async memberIds(gid) {
        const r = await read<{ user_id: string }>(
          "SELECT user_id FROM group_members WHERE group_id = $1",
          [gid],
        );
        return r.ok ? { ok: true, value: r.value.map((m) => m.user_id) } : r;
      },
      profiles: (ids) =>
        read<ProfileInput>(
          `SELECT id, display_name, travel_mode, home_place_id, unavailable_before::text,
                  unavailable_after::text FROM profiles WHERE id = ANY($1::uuid[])`,
          [ids],
        ),
      personalPlaces: (ids) =>
        read<PlaceInput>(
          "SELECT id, owner_id, name, lat, lng FROM places WHERE owner_id = ANY($1::uuid[]) AND group_id IS NULL",
          [ids],
        ),
      groupPlaces: (gid) =>
        read<PlaceInput>("SELECT id, owner_id, name, lat, lng FROM places WHERE group_id = $1", [
          gid,
        ]),
      groupBlocks: (gid) =>
        read<BusyBlockInput>(
          `SELECT id, owner_id, title, place_id, start_time::text, end_time::text, weekday,
                  valid_from::text, valid_until::text FROM public.group_busy_blocks($1)`,
          [gid],
        ),
    };
    const r = await searchGroupMeetups(
      store,
      {
        groupId: G,
        participantIds: [A, B],
        period: "this-week",
        durationMinutes: 30,
        bufferMinutes: 0,
      },
      { userId: B, now: NOW, travel: new EstimatedTravelProvider() },
    );
    if (!r.ok) throw new Error(r.error);
    const proposals = [...r.value.inPerson, ...r.value.calls];
    expect(proposals.length).toBeGreaterThan(0);
    for (const prop of proposals) {
      for (const s of p.sessions) {
        const overlap =
          Date.parse(prop.start) < Date.parse(s.end) && Date.parse(prop.end) > Date.parse(s.start);
        expect(overlap, `${prop.start} chevauche ${s.label}`).toBe(false);
      }
    }
  });
});
