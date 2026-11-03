/**
 * Segment 13 : échéances, séances d'étude acceptées et préférences d'étude (PGlite, requêtes
 * directes comme par l'API REST avec la clé anon et le jeton d'une personne).
 * A et B sont dans le groupe G ; C n'en fait pas partie.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asUser, FAKE_SUPABASE } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");
const MIGRATION_0011 = readFileSync(join(ROOT, "supabase/migration-0011.sql"), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

let db: PGlite;
let G: string;

const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
const affected = async (uid: string, sql: string, params: unknown[] = []) =>
  as(uid, async () => (await db.query(sql, params)).affectedRows ?? 0);

/** Ajoute une échéance au nom de `uid` (dans 3 jours par défaut). */
async function addDeadline(
  uid: string,
  course = "Chimie",
  due = "now() + interval '3 days'",
): Promise<string> {
  const [r] = await as(uid, () =>
    rows<{ id: string }>(
      `INSERT INTO deadlines (kind, course, due_at, difficulty) VALUES ('exam', $1, ${due}, 2) RETURNING id`,
      [course],
    ),
  );
  return r.id;
}

/** Séance acceptée (bloc 'study') au nom de `uid`. */
const addSession = (uid: string, deadline: string, title = "Étude : Chimie", movable = true) =>
  as(uid, () =>
    rows<{ id: string }>(
      `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source, deadline_id, movable)
       VALUES ($1, '10:00', '11:00', (now() + interval '1 day')::date, 'study', $2, $3) RETURNING id`,
      [title, deadline, movable],
    ),
  );

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
       ($2, 'sam@example.com', '{"full_name": "Sam"}'),
       ($3, 'zoe@example.com', '{"full_name": "Zoé"}')`,
    [A, B, C],
  );
  const [g] = await as(A, () => rows<{ id: string }>("SELECT public.create_group('Gang') AS id"));
  G = g.id;
  const [{ invite_code }] = await rows<{ invite_code: string }>(
    "SELECT invite_code FROM groups WHERE id = $1",
    [G],
  );
  await as(B, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
});

describe("deadlines : visibles et modifiables seulement par leur propriétaire", () => {
  it("un membre du même groupe ne voit, ne modifie ni ne supprime l'échéance d'un autre", async () => {
    const d = await addDeadline(A);
    expect(await as(A, () => rows("SELECT course FROM deadlines"))).toEqual([{ course: "Chimie" }]);
    for (const u of [B, C]) {
      expect(await as(u, () => rows("SELECT * FROM deadlines"))).toEqual([]);
      expect(await affected(u, "UPDATE deadlines SET course = 'x' WHERE id = $1", [d])).toBe(0);
      expect(await affected(u, "DELETE FROM deadlines WHERE id = $1", [d])).toBe(0);
    }
    expect(await rows("SELECT course FROM deadlines")).toEqual([{ course: "Chimie" }]);
  });

  it("on ne crée pas d'échéance au nom d'un autre, et owner_id ne se modifie pas", async () => {
    await expect(
      as(B, () =>
        rows(
          `INSERT INTO deadlines (owner_id, course, due_at) VALUES ($1, 'x', now() + interval '1 day')`,
          [A],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const d = await addDeadline(B);
    await expect(
      as(B, () => rows("UPDATE deadlines SET owner_id = $1 WHERE id = $2", [A, d])),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon (non connecté) n'a aucun accès", async () => {
    await addDeadline(A);
    for (const sql of [
      "SELECT * FROM deadlines",
      "INSERT INTO deadlines (course, due_at) VALUES ('x', now() + interval '1 day')",
      "DELETE FROM deadlines",
      "SELECT * FROM study_preferences",
      "INSERT INTO study_preferences DEFAULT VALUES",
    ]) {
      await expect(
        as(null, () => rows(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("limites : nom du cours, heures estimées, difficulté, dates", async () => {
    const insert = (cols: string, vals: string, params: unknown[] = []) =>
      as(A, () => rows(`INSERT INTO deadlines (${cols}) VALUES (${vals})`, params));
    const inThreeDays = "now() + interval '3 days'";
    await expect(insert("course, due_at", `'  ', ${inThreeDays}`)).rejects.toThrow(
      /deadlines_course_not_blank/,
    );
    await expect(insert("course, due_at", `$1, ${inThreeDays}`, ["x".repeat(81)])).rejects.toThrow(
      /deadlines_course_length/,
    );
    await expect(insert("course, due_at", `$1, ${inThreeDays}`, ["Chimie\rBEGIN"])).rejects.toThrow(
      /deadlines_course_chars/,
    );
    await expect(insert("course, due_at", `$1, ${inThreeDays}`, ["Chi\nmie"])).rejects.toThrow(
      /deadlines_course_chars/,
    );
    for (const h of [0, 0.25, 1.25, 61]) {
      await expect(
        insert("course, due_at, estimated_hours", `'x', ${inThreeDays}, $1`, [h]),
      ).rejects.toThrow(/deadlines_estimated_hours_range/);
    }
    await expect(insert("course, due_at, difficulty", `'x', ${inThreeDays}, 4`)).rejects.toThrow(
      /deadlines_difficulty_range/,
    );
    await expect(insert("course, due_at", "'x', now() - interval '3 days'")).rejects.toThrow(
      /année qui vient/,
    );
    await expect(insert("course, due_at", "'x', now() + interval '400 days'")).rejects.toThrow(
      /année qui vient/,
    );
    await expect(insert("course, due_at", "'x', '2150-01-01'")).rejects.toThrow(/année|range/);
    // Valeurs permises : accents, 80 caractères, 0,5 h et 60 h.
    await insert("course, due_at, estimated_hours", `$1, ${inThreeDays}, 0.5`, ["é".repeat(80)]);
    await insert("course, due_at, estimated_hours", `'Français', ${inThreeDays}, 60`);
    // Une échéance passée garde son nom modifiable (la date n'est revérifiée que si elle change).
    const [{ id }] = await rows<{ id: string }>(
      "INSERT INTO deadlines (owner_id, course, due_at) VALUES ($1, 'Vieux', now() + interval '1 day') RETURNING id",
      [A],
    );
    await db.query("ALTER TABLE deadlines DISABLE TRIGGER deadlines_limits");
    await db.query("UPDATE deadlines SET due_at = now() - interval '30 days' WHERE id = $1", [id]);
    await db.query("ALTER TABLE deadlines ENABLE TRIGGER deadlines_limits");
    expect(await affected(A, "UPDATE deadlines SET course = 'Vieux 2' WHERE id = $1", [id])).toBe(
      1,
    );
  });

  it("au plus 100 échéances par personne", async () => {
    await db.query(
      `INSERT INTO deadlines (owner_id, course, due_at)
       SELECT $1, 'c' || i, now() + interval '2 days' FROM generate_series(1, 100) i`,
      [A],
    );
    await expect(addDeadline(A)).rejects.toThrow(/100 au maximum/);
    await addDeadline(B); // les autres ne sont pas touchés
  });
});

describe("busy_blocks 'study' : séances acceptées", () => {
  it("une séance pointe vers MON échéance ; jamais vers celle d'un autre", async () => {
    const mine = await addDeadline(A);
    const hers = await addDeadline(B, "Secret");
    await addSession(A, mine);
    await expect(addSession(A, hers)).rejects.toThrow(/Échéance introuvable/);
    // Même par une modification (deadline_id n'est pas modifiable du tout).
    await as(A, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from) VALUES ('x', '08:00', '09:00', '2030-01-01')`,
      ),
    );
    await expect(
      as(A, () => rows("UPDATE busy_blocks SET deadline_id = $1", [hers])),
    ).rejects.toThrow(/permission denied/);
    // Et même en contournant la RLS (superutilisateur) : le trigger refuse.
    await expect(
      db.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, valid_from, source, deadline_id)
         VALUES ($1, 'x', '08:00', '09:00', '2030-01-01', 'study', $2)`,
        [A, hers],
      ),
    ).rejects.toThrow(/Échéance introuvable/);
  });

  it("une séance a une échéance, est ponctuelle ; seul un bloc d'étude est déplaçable", async () => {
    const d = await addDeadline(A);
    const insert = (cols: string, vals: string, params: unknown[] = []) =>
      as(A, () =>
        rows(
          `INSERT INTO busy_blocks (title, start_time, end_time, ${cols}) VALUES ('x', '08:00', '09:00', ${vals})`,
          params,
        ),
      );
    await expect(insert("valid_from, source", "'2030-01-01', 'study'")).rejects.toThrow(
      /busy_blocks_study_link/,
    );
    await expect(insert("valid_from, deadline_id", "'2030-01-01', $1", [d])).rejects.toThrow(
      /busy_blocks_study_link/,
    );
    await expect(insert("weekday, source, deadline_id", "2, 'study', $1", [d])).rejects.toThrow(
      /busy_blocks_study_one_off/,
    );
    await expect(insert("valid_from, movable", "'2030-01-01', true")).rejects.toThrow(
      /busy_blocks_movable_study/,
    );
    const [{ id }] = await addSession(A, d);
    await expect(
      as(A, () => rows("UPDATE busy_blocks SET weekday = 3 WHERE id = $1", [id])),
    ).rejects.toThrow(/busy_blocks_study_one_off/);
    // Déplacer (heures, jour) et changer « déplaçable » : permis.
    expect(
      await affected(
        A,
        "UPDATE busy_blocks SET start_time = '13:00', end_time = '14:00', movable = false WHERE id = $1",
        [id],
      ),
    ).toBe(1);
  });

  it("supprimer l'échéance retire ses séances ; un autre ne voit pas mes séances", async () => {
    const d = await addDeadline(A);
    await addSession(A, d);
    expect(await as(B, () => rows("SELECT * FROM busy_blocks WHERE source = 'study'"))).toEqual([]);
    await as(A, () => rows("DELETE FROM deadlines WHERE id = $1", [d]));
    expect(await rows("SELECT * FROM busy_blocks WHERE source = 'study'")).toEqual([]);
  });

  it("dans l'horaire du groupe, une séance est toujours « Occupé », même titres visibles", async () => {
    await as(A, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]));
    await as(A, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday) VALUES ('Cours de chimie', '08:00', '10:00', 1)`,
      ),
    );
    await addSession(A, await addDeadline(A, "Examen secret"), "Étude : Examen secret");
    const vus = await as(B, () =>
      rows<{ title: string; title_hidden: boolean; start_time: string }>(
        `SELECT title, title_hidden, start_time::text FROM public.group_busy_blocks($1)
         WHERE owner_id = $2 ORDER BY start_time`,
        [G, A],
      ),
    );
    expect(vus).toEqual([
      { title: "Cours de chimie", title_hidden: false, start_time: "08:00:00" },
      { title: "Occupé", title_hidden: true, start_time: "10:00:00" },
    ]);
    // A voit ses propres titres.
    const miens = await as(A, () =>
      rows<{ title: string }>("SELECT title FROM public.group_busy_blocks($1) ORDER BY title", [G]),
    );
    expect(miens.map((r) => r.title)).toEqual(["Cours de chimie", "Étude : Examen secret"]);
  });

  it("la limite de 1000 blocs s'applique aux séances", async () => {
    const d = await addDeadline(A);
    await db.query(
      `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, valid_from)
       SELECT $1, 'b', '08:00', '09:00', '2030-01-01'::date + i FROM generate_series(1, 1000) i`,
      [A],
    );
    await expect(addSession(A, d)).rejects.toThrow(/Trop de blocs/);
  });
});

describe("study_preferences : seulement les miennes, dans les bornes", () => {
  it("lecture et écriture par le propriétaire seulement", async () => {
    await as(A, () =>
      rows(
        "INSERT INTO study_preferences (min_session_minutes, max_session_minutes) VALUES (30, 90)",
      ),
    );
    expect(await as(B, () => rows("SELECT * FROM study_preferences"))).toEqual([]);
    expect(await affected(B, "UPDATE study_preferences SET break_minutes = 0")).toBe(0);
    expect(await affected(B, "DELETE FROM study_preferences")).toBe(0);
    await expect(
      as(B, () => rows("INSERT INTO study_preferences (owner_id) VALUES ($1)", [A])),
    ).rejects.toThrow(/row-level security|duplicate/);
    const [p] = await as(A, () =>
      rows<{ min_session_minutes: number; eve_cutoff: string }>(
        "SELECT min_session_minutes, eve_cutoff::text FROM study_preferences",
      ),
    );
    expect(p).toEqual({ min_session_minutes: 30, eve_cutoff: "21:00:00" });
  });

  it("bornes : durées, maximum par jour, pause, heures, part gardée libre", async () => {
    const bad: Array<[string, RegExp]> = [
      ["min_session_minutes = 20", /min_session/],
      ["min_session_minutes = 50", /min_session/],
      ["max_session_minutes = 300", /max_session/],
      ["max_minutes_per_day = 700", /max_per_day/],
      ["break_minutes = 90", /break/],
      ["study_start = '20:00', study_end = '20:30'", /hours/],
      ["keep_free_percent = 95", /keep_free/],
    ];
    await as(A, () => rows("INSERT INTO study_preferences DEFAULT VALUES"));
    for (const [set, re] of bad) {
      await expect(
        as(A, () => rows(`UPDATE study_preferences SET ${set}`)),
        set,
      ).rejects.toThrow(re);
    }
  });
});

describe("droits des nouvelles fonctions", () => {
  it("anon et authenticated ne peuvent pas exécuter les fonctions des triggers", async () => {
    for (const fn of ["enforce_deadline_limits()", "check_block_deadline_owner()"]) {
      for (const role of ["anon", "authenticated"]) {
        const [r] = await rows<{ ok: boolean }>(
          `SELECT has_function_privilege($1, 'public.${fn}', 'EXECUTE') AS ok`,
          [role],
        );
        expect(r.ok, `${role} ${fn}`).toBe(false);
      }
    }
    const [r] = await rows<{ ok: boolean }>(
      "SELECT has_function_privilege('anon', 'public.group_busy_blocks(uuid)', 'EXECUTE') AS ok",
    );
    expect(r.ok).toBe(false);
  });
});

describe("migration 0011 sur une base en 0010 avec des données", () => {
  it("s'applique, garde les blocs (dont 'meetup') et les plans, et les nouveautés marchent", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      const journal = JSON.parse(
        readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"),
      ) as {
        entries: { idx: number; tag: string }[];
      };
      for (const e of journal.entries.filter((x) => x.idx <= 10)) {
        await ancienne.exec(
          readFileSync(join(ROOT, "drizzle", `${e.tag}.sql`), "utf8").replace(
            /-->\s*statement-breakpoint/g,
            "",
          ),
        );
      }
      await ancienne.query(
        "INSERT INTO auth.users (id, email) VALUES ($1, 'a@x.com'), ($2, 'b@x.com')",
        [A, B],
      );
      const q = async <T>(uid: string, sql: string, params: unknown[] = []) =>
        (await asUser(ancienne, uid, () => ancienne.query<T>(sql, params))).rows;
      const [{ id: gid }] = await q<{ id: string }>(A, "SELECT public.create_group('G') AS id");
      const [{ invite_code }] = await q<{ invite_code: string }>(
        A,
        "SELECT invite_code FROM groups",
      );
      await q(B, "SELECT public.join_group_by_code($1)", [invite_code]);
      await q(
        B,
        "INSERT INTO busy_blocks (title, start_time, end_time, weekday) VALUES ('Cours', '10:00', '12:00', 1)",
      );
      const [{ id: plan }] = await q<{ id: string }>(
        A,
        `SELECT public.propose_meetup($1, now() + interval '2 days', now() + interval '2 days 1 hour', 'Souper') AS id`,
        [gid],
      );
      await q(B, "SELECT public.respond_to_meetup($1, true)", [plan]);
      // Ancien bloc 'study' écrit par l'API REST, sans échéance (permis avant la 0011).
      await q(
        B,
        "INSERT INTO busy_blocks (title, start_time, end_time, weekday, source) VALUES ('Étude', '18:00', '19:00', 3, 'study')",
      );

      await ancienne.exec(MIGRATION_0011);

      const blocs = await q<{ title: string; source: string; movable: boolean }>(
        B,
        "SELECT title, source::text, movable FROM busy_blocks ORDER BY title",
      );
      expect(blocs).toEqual([
        { title: "Cours", source: "manual", movable: false },
        { title: "Souper", source: "meetup", movable: false },
        { title: "Étude", source: "study", movable: false },
      ]);
      expect((await q(A, "SELECT status::text FROM meetup_plans")).length).toBe(1);
      // Nouveautés : échéance, séance, confidentialité, préférences.
      const [{ id: d }] = await q<{ id: string }>(
        B,
        "INSERT INTO deadlines (course, due_at) VALUES ('Chimie', now() + interval '3 days') RETURNING id",
      );
      await q(
        B,
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source, deadline_id, movable)
         VALUES ('Étude : Chimie', '13:00', '14:00', (now() + interval '1 day')::date, 'study', $1, true)`,
        [d],
      );
      expect(await q(A, "SELECT * FROM deadlines")).toEqual([]);
      const vus = await q<{ title: string }>(
        A,
        "SELECT title FROM public.group_busy_blocks($1) WHERE owner_id = $2 AND title LIKE 'Étude%'",
        [gid, B],
      );
      expect(vus).toEqual([]);
      await q(B, "INSERT INTO study_preferences DEFAULT VALUES");
      // Le plan se refuse toujours (le bloc 'meetup' est retiré).
      await q(B, "SELECT public.respond_to_meetup($1, false)", [plan]);
      expect((await q(B, "SELECT * FROM busy_blocks WHERE source::text = 'meetup'")).length).toBe(
        0,
      );

      // La relancer échoue sans rien casser (transaction).
      await expect(ancienne.exec(MIGRATION_0011)).rejects.toThrow(/already exists/);
      await ancienne.exec("ROLLBACK");
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});
