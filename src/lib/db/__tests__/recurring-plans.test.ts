/**
 * Story 5 : plans récurrents partagés (PGlite, requêtes directes comme par l'API REST).
 * A, B et C sont dans le groupe G ; D n'en fait pas partie.
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
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";

let db: PGlite;
let G: string;

const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

/** Propose un plan récurrent au nom de `uid` (par défaut : gym tous les 2 jours, 18 h – 19 h 30). */
async function proposeSeries(
  uid: string,
  opts: {
    start?: string;
    end?: string;
    unit?: string | null;
    every?: number | null;
    until?: string | null;
    invitees?: string[] | null;
  } = {},
): Promise<string> {
  const [r] = await as(uid, () =>
    rows<{ id: string }>(
      `SELECT public.propose_recurring_meetup(
         p_group => $1, p_starts_at => $2::timestamptz, p_ends_at => $3::timestamptz,
         p_title => 'Gym', p_repeat_unit => $4, p_repeat_every => $5, p_repeat_until => $6::date,
         p_invitees => $7) AS id`,
      [
        G,
        opts.start ?? "2027-03-16 18:00-04",
        opts.end ?? "2027-03-16 19:30-04",
        opts.unit === undefined ? "day" : opts.unit,
        opts.every === undefined ? 2 : opts.every,
        opts.until ?? null,
        opts.invitees === undefined ? [B] : opts.invitees,
      ],
    ),
  );
  return r.id;
}

const respond = (uid: string, plan: string, accept: boolean) =>
  as(uid, () => rows("SELECT public.respond_to_meetup($1, $2)", [plan, accept]));
const cancel = (uid: string, plan: string) =>
  as(uid, () => rows("SELECT public.cancel_meetup($1)", [plan]));

/** Blocs « plan » de `uid`, lus par lui-même (RLS). */
const meetupBlocks = (uid: string) =>
  as(uid, () =>
    rows(
      `SELECT start_time::text, end_time::text, weekday, valid_from::text, valid_until::text,
         repeat_unit, repeat_every
       FROM busy_blocks WHERE source::text = 'meetup' ORDER BY valid_from`,
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
       ($3, 'zoe@example.com', '{"full_name": "Zoé"}'),
       ($4, 'dan@example.com', '{"full_name": "Dan"}')`,
    [A, B, C, D],
  );
  const [g] = await as(A, () => rows<{ id: string }>("SELECT public.create_group('Gang') AS id"));
  G = g.id;
  const [{ invite_code }] = await rows<{ invite_code: string }>(
    "SELECT invite_code FROM groups WHERE id = $1",
    [G],
  );
  for (const u of [B, C]) {
    await as(u, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
  }
});

describe("Story 5 : plans récurrents partagés", () => {
  it("le créateur a UN bloc qui se répète ; l'invité l'a aussi dès qu'il accepte", async () => {
    const plan = await proposeSeries(A, { until: "2027-06-30" });
    expect(
      await as(B, () =>
        rows("SELECT repeat_unit, repeat_every, repeat_until::text FROM meetup_plans"),
      ),
    ).toEqual([{ repeat_unit: "day", repeat_every: 2, repeat_until: "2027-06-30" }]);
    const expected = {
      start_time: "18:00:00",
      end_time: "19:30:00",
      weekday: null,
      valid_from: "2027-03-16",
      valid_until: "2027-06-30",
      repeat_unit: "day",
      repeat_every: 2,
    };
    expect(await meetupBlocks(A)).toEqual([expected]);
    expect(await meetupBlocks(B)).toEqual([]);

    await respond(B, plan, true);
    expect(await meetupBlocks(B)).toEqual([expected]);
    // Les autres membres du groupe voient la répétition (elle compte comme occupé pour eux aussi).
    const seen = await as(C, () =>
      rows<{ owner_id: string; repeat_unit: string; repeat_every: number }>(
        "SELECT owner_id, repeat_unit, repeat_every FROM public.group_busy_blocks($1) ORDER BY owner_id",
        [G],
      ),
    );
    expect(seen).toEqual([
      { owner_id: A, repeat_unit: "day", repeat_every: 2 },
      { owner_id: B, repeat_unit: "day", repeat_every: 2 },
    ]);
  });

  it("chaque semaine : le jour de semaine de la première fois ; sans fin", async () => {
    // 2027-03-16 est un mardi.
    await proposeSeries(A, { unit: "week", every: 1 });
    expect(await meetupBlocks(A)).toEqual([
      {
        start_time: "18:00:00",
        end_time: "19:30:00",
        weekday: 2,
        valid_from: "2027-03-16",
        valid_until: null,
        repeat_unit: "week",
        repeat_every: 1,
      },
    ]);
  });

  it("quitter la série la retire de MON horaire seulement", async () => {
    const plan = await proposeSeries(A);
    await respond(B, plan, true);
    await respond(B, plan, false);
    expect(await meetupBlocks(B)).toEqual([]);
    expect(await meetupBlocks(A)).toHaveLength(1);
  });

  it("une série déjà commencée reste ouverte : on l'accepte ou la quitte encore", async () => {
    const plan = await proposeSeries(A);
    await db.query(
      `UPDATE meetup_plans SET starts_at = now() - interval '3 days',
         ends_at = now() - interval '3 days' + interval '1 hour' WHERE id = $1`,
      [plan],
    );
    await respond(B, plan, true);
    await respond(B, plan, false);
    // Série finie (dernier jour passé) : plus de réponse.
    await db.query("UPDATE meetup_plans SET repeat_until = current_date - 2 WHERE id = $1", [plan]);
    await expect(respond(B, plan, true)).rejects.toThrow(/passé/);
  });

  it("le créateur ou une personne inscrite arrête la série pour tout le monde", async () => {
    const plan = await proposeSeries(A, { invitees: null });
    await respond(B, plan, true);
    // C n'a pas accepté : il ne peut pas arrêter la série.
    await expect(cancel(C, plan)).rejects.toThrow(/inscrites/);
    await cancel(B, plan);
    expect(await rows("SELECT status::text FROM meetup_plans")).toEqual([{ status: "cancelled" }]);
    for (const u of [A, B, C]) expect(await meetupBlocks(u)).toEqual([]);
    await expect(respond(C, plan, true)).rejects.toThrow(/annulé/);
  });

  it("un plan d'une seule fois reste annulable par son créateur seulement", async () => {
    const [r] = await as(A, () =>
      rows<{ id: string }>(
        "SELECT public.propose_meetup($1, '2027-03-16 18:00-04', '2027-03-16 20:00-04', 'Souper') AS id",
        [G],
      ),
    );
    await respond(B, r.id, true);
    await expect(cancel(B, r.id)).rejects.toThrow(/Seule la personne/);
  });

  it("refuse une répétition invalide sans rien enregistrer", async () => {
    await expect(proposeSeries(A, { unit: "hour" })).rejects.toThrow(/Répétition invalide/);
    await expect(proposeSeries(A, { unit: null })).rejects.toThrow(/Répétition invalide/);
    await expect(proposeSeries(A, { every: 0 })).rejects.toThrow(/1 à 99/);
    await expect(proposeSeries(A, { every: 100 })).rejects.toThrow(/1 à 99/);
    await expect(proposeSeries(A, { until: "2027-03-15" })).rejects.toThrow(/après la première/);
    await expect(proposeSeries(A, { until: "2037-03-16" })).rejects.toThrow(/10 ans/);
    // Les règles de propose_meetup s'appliquent aussi (ex. au moins une autre personne).
    await expect(proposeSeries(A, { invitees: [] })).rejects.toThrow(/au moins une autre/);
    await expect(proposeSeries(D)).rejects.toThrow(/Groupe introuvable/);
    expect(await rows("SELECT * FROM meetup_plans")).toEqual([]);
    expect(await rows("SELECT * FROM busy_blocks")).toEqual([]);
  });

  it("la base refuse une répétition incohérente même écrite directement", async () => {
    const plan = await proposeSeries(A);
    await expect(
      db.query(
        "UPDATE meetup_plans SET repeat_unit = NULL, repeat_every = 3, repeat_until = NULL WHERE id = $1",
        [plan],
      ),
    ).rejects.toThrow(/meetup_plans_repeat_shape/);
    await expect(
      db.query("UPDATE meetup_plans SET repeat_every = 0 WHERE id = $1", [plan]),
    ).rejects.toThrow(/meetup_plans_repeat_every_range/);
    // Une personne connectée ne peut toujours pas écrire dans les plans.
    await expect(
      as(A, () => rows("UPDATE meetup_plans SET repeat_every = 5 WHERE id = $1", [plan])),
    ).rejects.toThrow(/permission denied/);
  });

  it("un bloc « tous les jours » compte pour 7 dans la limite de 1000 blocs", async () => {
    await db.query(
      `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday)
       SELECT $1, 'Cours', '08:00', '09:00', 1 + (g % 7) FROM generate_series(1, 995) g`,
      [B],
    );
    const plan = await proposeSeries(A, { every: 1 });
    await expect(respond(B, plan, true)).rejects.toThrow(/Trop de blocs/);
    expect(await meetupBlocks(B)).toEqual([]);
  });

  it("anon ne peut pas proposer de série", async () => {
    await expect(
      as(null, () =>
        rows(
          "SELECT public.propose_recurring_meetup(gen_random_uuid(), now(), now(), 'x', 'day', 1)",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(A, () => rows("SELECT public.meetup_plan_over(now(), NULL, NULL)")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("Story 5 : migration 0018 sur une base en 0017 avec un plan existant", () => {
  it("s'applique, garde le plan et son bloc, et les séries fonctionnent", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      const journal = JSON.parse(
        readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      for (const { tag } of journal.entries.filter((e) => e.idx <= 17)) {
        await ancienne.exec(
          readFileSync(join(ROOT, "drizzle", `${tag}.sql`), "utf8").replace(
            /-->\s*statement-breakpoint/g,
            "",
          ),
        );
      }
      await ancienne.query(
        "INSERT INTO auth.users (id, email) VALUES ($1, 'a@x.com'), ($2, 'b@x.com')",
        [A, B],
      );
      const old = <T>(uid: string, fn: () => Promise<T>) => asUser(ancienne, uid, fn);
      const [{ id: gid }] = await old(
        A,
        async () =>
          (await ancienne.query<{ id: string }>("SELECT public.create_group('Gang') AS id")).rows,
      );
      const [{ invite_code }] = (
        await ancienne.query<{ invite_code: string }>(
          "SELECT invite_code FROM groups WHERE id = $1",
          [gid],
        )
      ).rows;
      await old(B, () => ancienne.query("SELECT public.join_group_by_code($1)", [invite_code]));
      const [{ id: plan }] = await old(
        A,
        async () =>
          (
            await ancienne.query<{ id: string }>(
              "SELECT public.propose_meetup($1, '2027-03-16 18:00-04', '2027-03-16 20:00-04', 'Souper') AS id",
              [gid],
            )
          ).rows,
      );
      await old(B, () => ancienne.query("SELECT public.respond_to_meetup($1, true)", [plan]));

      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0018.sql"), "utf8"));

      expect(
        (
          await ancienne.query(
            "SELECT title, repeat_unit, repeat_every, repeat_until FROM meetup_plans",
          )
        ).rows,
      ).toEqual([{ title: "Souper", repeat_unit: null, repeat_every: 1, repeat_until: null }]);
      expect(
        (
          await ancienne.query(
            "SELECT count(*)::int AS n FROM busy_blocks WHERE source::text = 'meetup'",
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
      const [{ id: serie }] = await old(
        A,
        async () =>
          (
            await ancienne.query<{ id: string }>(
              "SELECT public.propose_recurring_meetup($1, '2027-03-17 07:00-04', '2027-03-17 08:00-04', 'Gym', 'day', 1) AS id",
              [gid],
            )
          ).rows,
      );
      await old(B, () => ancienne.query("SELECT public.respond_to_meetup($1, true)", [serie]));
      await old(B, () => ancienne.query("SELECT public.cancel_meetup($1)", [serie]));
      expect(
        (await ancienne.query("SELECT status::text FROM meetup_plans WHERE id = $1", [serie])).rows,
      ).toEqual([{ status: "cancelled" }]);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});
