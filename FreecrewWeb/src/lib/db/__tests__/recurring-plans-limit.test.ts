/**
 * Revue story 5 : la limite « 50 plans à venir » par groupe compte aussi les séries
 * récurrentes en cours, même quand leur première fois est passée.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asUser, FAKE_SUPABASE } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;
let G: string;

const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

const series = (start: string, end: string, until: string | null = null) =>
  as(A, () =>
    rows(
      `SELECT public.propose_recurring_meetup(
         p_group => $1, p_starts_at => $2::timestamptz, p_ends_at => $3::timestamptz,
         p_title => 'Gym', p_repeat_unit => 'week', p_repeat_every => 1,
         p_repeat_until => $4::date, p_invitees => $5)`,
      [G, start, end, until, [B]],
    ),
  );
const single = (start: string, end: string) =>
  as(A, () =>
    rows(
      `SELECT public.propose_meetup(p_group => $1, p_starts_at => $2::timestamptz,
         p_ends_at => $3::timestamptz, p_title => 'Café', p_invitees => $4)`,
      [G, start, end, [B]],
    ),
  );

/** Fait comme si les plans déjà créés dataient d'il y a 60 jours (première fois passée). */
const ageAll = () =>
  db.exec(`RESET ROLE;
    UPDATE meetup_plans SET created_at = created_at - interval '60 days',
      starts_at = starts_at - interval '60 days', ends_at = ends_at - interval '60 days',
      repeat_until = repeat_until - 60;`);

const soon = (days: number, h: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};

/** 50 séries hebdomadaires sans fin, dont la première fois est passée. */
async function fiftyRunningSeries(until: string | null = null) {
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 10; i++) await series(soon(2 + i, 15), soon(2 + i, 16), until);
    await ageAll();
  }
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
       ($1, 'ali@example.com', '{"full_name": "Ali"}'), ($2, 'sam@example.com', '{"full_name": "Sam"}')`,
    [A, B],
  );
  const [g] = await as(A, () => rows("SELECT public.create_group('Gang') AS id"));
  G = (g as { id: string }).id;
  const [c] = await rows("SELECT invite_code FROM groups WHERE id = $1", [G]);
  await as(B, () =>
    rows("SELECT public.join_group_by_code($1)", [(c as { invite_code: string }).invite_code]),
  );
});

describe("Revue story 5 : 50 plans à venir, séries comprises", () => {
  it("refuse une 51e série quand 50 séries sans fin continuent", async () => {
    await fiftyRunningSeries();
    await expect(series(soon(3, 15), soon(3, 16))).rejects.toMatchObject({ code: "54000" });
    await expect(single(soon(3, 15), soon(3, 16))).rejects.toMatchObject({ code: "54000" });
  }, 60_000);

  it("une série finie ne compte plus", async () => {
    // Fin il y a 10 jours (après le vieillissement de 60 jours) : elle est finie.
    await fiftyRunningSeries(soon(50, 12).slice(0, 10));
    await series(soon(3, 15), soon(3, 16));
    await single(soon(4, 15), soon(4, 16));
  }, 60_000);
});
