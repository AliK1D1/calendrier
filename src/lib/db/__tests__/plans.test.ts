/**
 * Segment 12 : proposer un moment au groupe (PGlite, requêtes directes comme par l'API REST).
 * A, B et C sont dans le groupe G ; D n'en fait pas partie.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asUser, FAKE_SUPABASE } from "./pgliteHarness";

// Insère environ 1000 lignes dans PGlite : lent quand toute la suite tourne en parallèle.
const LONG_DB_TEST_MS = 30_000;

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");
const MIGRATION_0009 = readFileSync(join(ROOT, "supabase/migration-0009.sql"), "utf8");

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

/** Propose un plan au nom de `uid` ; `invitees` nul = tout le groupe. */
async function propose(
  uid: string,
  opts: {
    group?: string;
    start?: string;
    end?: string;
    title?: string;
    place?: string | null;
    location?: string;
    invitees?: string[] | null;
  } = {},
): Promise<string> {
  const [r] = await as(uid, () =>
    rows<{ id: string }>(
      "SELECT public.propose_meetup($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7) AS id",
      [
        opts.group ?? G,
        opts.start ?? "2027-03-16 18:00-04",
        opts.end ?? "2027-03-16 20:00-04",
        opts.title ?? "Souper",
        opts.place ?? null,
        opts.location ?? "",
        opts.invitees === undefined ? null : opts.invitees,
      ],
    ),
  );
  return r.id;
}

const respond = (uid: string, plan: string, accept: boolean) =>
  as(uid, () => rows("SELECT public.respond_to_meetup($1, $2)", [plan, accept]));

/** Blocs « plan » de `uid`, lus par lui-même (RLS). */
const meetupBlocks = (uid: string) =>
  as(uid, () =>
    rows<{
      meetup_plan_id: string;
      start_time: string;
      end_time: string;
      valid_from: string;
      title: string;
    }>(
      `SELECT meetup_plan_id, start_time::text, end_time::text, valid_from::text, title
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

describe("Segment 12 : proposer un moment", () => {
  it("à tout le groupe : chacun voit le plan et est invité ; le proposant a accepté et a le bloc", async () => {
    const plan = await propose(A);
    for (const u of [A, B, C]) {
      const plans = await as(u, () =>
        rows<{ id: string; title: string; status: string }>(
          "SELECT id, title, status::text FROM meetup_plans",
        ),
      );
      expect(plans).toEqual([{ id: plan, title: "Souper", status: "proposed" }]);
      const inv = await as(u, () =>
        rows<{ user_id: string }>("SELECT user_id FROM plan_invitees ORDER BY user_id"),
      );
      expect(inv.map((i) => i.user_id)).toEqual([A, B, C]);
    }
    expect(await as(A, () => rows("SELECT user_id, vote::text FROM plan_votes"))).toEqual([
      { user_id: A, vote: "yes" },
    ]);
    // Heures locales (heure avancée de l'Est en mars 2027 : UTC-4).
    expect(await meetupBlocks(A)).toEqual([
      {
        meetup_plan_id: plan,
        start_time: "18:00:00",
        end_time: "20:00:00",
        valid_from: "2027-03-16",
        title: "Souper",
      },
    ]);
    expect(await meetupBlocks(B)).toEqual([]);
    // D (hors groupe) ne voit rien.
    for (const t of ["meetup_plans", "plan_invitees", "plan_votes"]) {
      expect(await as(D, () => rows(`SELECT * FROM ${t}`))).toEqual([]);
    }
  });

  it("aux membres choisis : un membre non invité voit le plan mais ne peut pas répondre", async () => {
    const plan = await propose(A, { invitees: [B] });
    const inv = await as(C, () =>
      rows<{ user_id: string }>("SELECT user_id FROM plan_invitees ORDER BY user_id"),
    );
    expect(inv.map((i) => i.user_id)).toEqual([A, B]);
    await expect(respond(C, plan, true)).rejects.toThrow(/pas invité/);
    expect(await meetupBlocks(C)).toEqual([]);
    await respond(B, plan, true);
    expect((await meetupBlocks(B)).map((b) => b.meetup_plan_id)).toEqual([plan]);
  });

  it("on n'invite que des membres, et au moins une autre personne", async () => {
    await expect(propose(A, { invitees: [B, D] })).rejects.toThrow(/membres du groupe/);
    await expect(propose(A, { invitees: [A] })).rejects.toThrow(/au moins une autre/);
    await expect(propose(A, { invitees: [] })).rejects.toThrow(/au moins une autre/);
    expect(await rows("SELECT * FROM meetup_plans")).toEqual([]);
  });

  it("un non-membre ne propose rien dans le groupe et ne répond pas", async () => {
    await expect(propose(D)).rejects.toThrow(/Groupe introuvable/);
    const plan = await propose(A);
    await expect(respond(D, plan, true)).rejects.toThrow(/Plan introuvable/);
    await expect(as(D, () => rows("SELECT public.cancel_meetup($1)", [plan]))).rejects.toThrow(
      /Plan introuvable/,
    );
    expect(await meetupBlocks(D)).toEqual([]);
  });

  it("accepter ajoute le bloc même s'il chevauche ; refuser le retire ; on peut changer d'avis", async () => {
    // B travaille déjà le mardi soir (bloc hebdomadaire qui chevauche).
    await as(B, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ('Travail', '17:00', '21:00', 2, '2027-01-04', '2027-04-30')`,
      ),
    );
    const plan = await propose(A);
    await respond(B, plan, true);
    expect(await meetupBlocks(B)).toHaveLength(1);
    // Accepter deux fois ne crée pas de doublon.
    await respond(B, plan, true);
    expect(await meetupBlocks(B)).toHaveLength(1);

    // Les autres membres voient le bloc « Occupé » dans l'horaire du groupe (confidentialité).
    const vu = await as(A, () =>
      rows<{ title: string; start_time: string }>(
        `SELECT title, start_time::text FROM public.group_busy_blocks($1)
         WHERE owner_id = $2 AND weekday IS NULL`,
        [G, B],
      ),
    );
    expect(vu).toEqual([{ title: "Occupé", start_time: "18:00:00" }]);

    await respond(B, plan, false);
    expect(await meetupBlocks(B)).toEqual([]);
    expect(
      await as(B, () => rows("SELECT vote::text FROM plan_votes WHERE user_id = $1", [B])),
    ).toEqual([{ vote: "no" }]);
    await respond(B, plan, true);
    expect(await meetupBlocks(B)).toHaveLength(1);
    // Le bloc de travail n'a pas bougé.
    expect(
      await as(B, () => rows("SELECT title FROM busy_blocks WHERE source = 'manual'")),
    ).toEqual([{ title: "Travail" }]);
  });

  it("le bloc d'un plan ne se modifie ni ne se supprime directement, et ne se fabrique pas", async () => {
    const plan = await propose(A);
    await respond(B, plan, true);
    const upd = await as(
      B,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'x' WHERE meetup_plan_id IS NOT NULL"))
          .affectedRows,
    );
    expect(upd).toBe(0);
    const del = await as(
      B,
      async () =>
        (await db.query("DELETE FROM busy_blocks WHERE meetup_plan_id IS NOT NULL")).affectedRows,
    );
    expect(del).toBe(0);
    expect(await meetupBlocks(B)).toHaveLength(1);
    // Écrire meetup_plan_id est interdit (droits par colonne) ; source 'meetup' sans plan aussi.
    await expect(
      as(B, () =>
        rows(
          `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, meetup_plan_id)
           VALUES ('faux', '08:00', '09:00', '2027-03-16', $1)`,
          [plan],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(B, () =>
        rows(
          `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source)
           VALUES ('faux', '08:00', '09:00', '2027-03-16', 'meetup')`,
        ),
      ),
    ).rejects.toThrow(/busy_blocks_meetup_link/);
    await expect(
      as(B, () =>
        rows("UPDATE busy_blocks SET meetup_plan_id = NULL WHERE meetup_plan_id IS NOT NULL"),
      ),
    ).rejects.toThrow(/permission denied/);
    // Les blocs ordinaires se modifient toujours.
    await as(B, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from)
         VALUES ('Dentiste', '08:00', '09:00', '2027-03-16')`,
      ),
    );
    const ok = await as(
      B,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'Dentiste 2' WHERE source = 'manual'"))
          .affectedRows,
    );
    expect(ok).toBe(1);
  });

  it("seul le créateur annule ; l'annulation retire le bloc de tout le monde", async () => {
    const plan = await propose(A);
    await respond(B, plan, true);
    await respond(C, plan, true);
    await expect(as(B, () => rows("SELECT public.cancel_meetup($1)", [plan]))).rejects.toThrow(
      /Seule la personne/,
    );
    await expect(respond(A, plan, false)).rejects.toThrow(/annule-la plutôt/);
    await as(A, () => rows("SELECT public.cancel_meetup($1)", [plan]));
    expect(await rows("SELECT status::text FROM meetup_plans")).toEqual([{ status: "cancelled" }]);
    for (const u of [A, B, C]) expect(await meetupBlocks(u)).toEqual([]);
    await expect(respond(B, plan, true)).rejects.toThrow(/annulé/);
  });

  it("un plan passé ne se répond plus", async () => {
    const plan = await propose(A);
    await db.query(
      "UPDATE meetup_plans SET starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' WHERE id = $1",
      [plan],
    );
    await expect(respond(B, plan, true)).rejects.toThrow(/passé/);
  });

  it("limites : titre, durée, moment passé, minuit, lieu d'un autre groupe", async () => {
    await expect(propose(A, { title: "  " })).rejects.toThrow(/titre/);
    await expect(propose(A, { title: "x".repeat(81) })).rejects.toThrow(/titre/);
    await expect(propose(A, { location: "x".repeat(101) })).rejects.toThrow(/lieu/);
    await expect(
      propose(A, { start: "2027-03-16 08:00-04", end: "2027-03-16 20:30-04" }),
    ).rejects.toThrow(/12 heures/);
    await expect(
      propose(A, { start: "2027-03-16 08:00-04", end: "2027-03-16 08:10-04" }),
    ).rejects.toThrow(/15 minutes/);
    await expect(
      propose(A, { start: "2020-03-12 08:00-04", end: "2020-03-12 09:00-04" }),
    ).rejects.toThrow(/passé/);
    await expect(
      propose(A, { start: "2027-03-16 22:00-04", end: "2027-03-17 01:00-04" }),
    ).rejects.toThrow(/même jour/);
    // Finir pile à minuit : bloc jusqu'à 24:00.
    const minuit = await propose(A, { start: "2027-03-16 22:00-04", end: "2027-03-17 00:00-04" });
    expect((await meetupBlocks(A)).find((b) => b.meetup_plan_id === minuit)?.end_time).toBe(
      "24:00:00",
    );
    // Écrit directement, la BD refuse aussi un titre trop long (contrainte).
    await expect(
      rows("UPDATE meetup_plans SET title = $1 WHERE id = $2", ["x".repeat(81), minuit]),
    ).rejects.toThrow(/meetup_plans_title_length/);
  });

  it("au plus 10 propositions par personne et par jour dans un groupe", async () => {
    for (let i = 0; i < 10; i++) {
      await propose(A, {
        start: `2027-03-${String(10 + i).padStart(2, "0")} 18:00-04`,
        end: `2027-03-${String(10 + i).padStart(2, "0")} 19:00-04`,
      });
    }
    await expect(propose(A)).rejects.toThrow(/10 moments/);
    // B peut encore proposer.
    await propose(B);
  });

  it(
    "limite de 1000 blocs : accepter échoue avec un message clair, rien n'est enregistré",
    async () => {
      const plan = await propose(A);
      await db.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, valid_from)
       SELECT $1, 'b', '08:00', '09:00', '2030-01-01'::date + i FROM generate_series(1, 1000) i`,
        [B],
      );
      await expect(respond(B, plan, true)).rejects.toThrow(/Trop de blocs/);
      expect(await meetupBlocks(B)).toEqual([]);
      expect(await as(B, () => rows("SELECT * FROM plan_votes WHERE user_id = $1", [B]))).toEqual(
        [],
      );
    },
    LONG_DB_TEST_MS,
  );

  it("quitter le groupe retire ses réponses et les blocs de ses plans", async () => {
    const plan = await propose(A);
    await respond(B, plan, true);
    await as(B, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [G, B]),
    );
    expect(await meetupBlocks(B)).toEqual([]);
    const inv = await rows<{ user_id: string }>(
      "SELECT user_id FROM plan_invitees ORDER BY user_id",
    );
    expect(inv.map((i) => i.user_id)).toEqual([A, C]);
    expect(await rows("SELECT user_id FROM plan_votes")).toEqual([{ user_id: A }]);
  });

  it("supprimer le groupe supprime ses plans et leurs blocs", async () => {
    const plan = await propose(A);
    await respond(B, plan, true);
    await db.query("DELETE FROM groups WHERE id = $1", [G]);
    expect(await rows("SELECT * FROM meetup_plans")).toEqual([]);
    expect(await rows("SELECT * FROM busy_blocks WHERE meetup_plan_id IS NOT NULL")).toEqual([]);
  });

  it("anon ne peut exécuter aucune fonction des plans ni lire les invités", async () => {
    for (const fn of [
      "propose_meetup(gen_random_uuid(), now(), now(), 'x')",
      "respond_to_meetup(gen_random_uuid(), true)",
      "cancel_meetup(gen_random_uuid())",
      "add_meetup_block(gen_random_uuid(), gen_random_uuid())",
    ]) {
      await expect(as(null, () => rows(`SELECT public.${fn}`))).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(as(null, () => rows("SELECT * FROM plan_invitees"))).rejects.toThrow(
      /permission denied/,
    );
    // La fonction interne n'est pas appelable non plus par une personne connectée.
    await expect(
      as(B, () => rows("SELECT public.add_meetup_block(gen_random_uuid(), $1)", [B])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("Segment 12 : migration 0009 sur une base en 0008 avec des données", () => {
  it("s'applique, garde les plans et votes existants et rend les nouvelles fonctions utilisables", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      const tags = [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
        "0006_groups",
        "0007_review_kick_new_code",
        "0008_review_row_limits",
      ];
      for (const tag of tags) {
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
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday) VALUES ('Cours', '10:00', '12:00', 1)`,
      );
      // Ancien plan (sans titre), vote « peut-être » et plan de plus de 12 h : gardés.
      const [{ id: ancien }] = await q<{ id: string }>(
        A,
        `INSERT INTO meetup_plans (group_id, starts_at, ends_at)
         VALUES ($1, '2030-01-01 08:00-05', '2030-01-01 23:00-05') RETURNING id`,
        [gid],
      );
      await q(B, "INSERT INTO plan_votes (plan_id, vote) VALUES ($1, 'maybe')", [ancien]);

      await ancienne.exec(MIGRATION_0009);

      expect((await ancienne.query("SELECT title, location FROM meetup_plans")).rows).toEqual([
        { title: "", location: "" },
      ]);
      expect((await ancienne.query("SELECT vote::text FROM plan_votes")).rows).toEqual([
        { vote: "maybe" },
      ]);
      expect((await ancienne.query("SELECT count(*)::int AS n FROM busy_blocks")).rows).toEqual([
        { n: 1 },
      ]);
      // Les nouvelles fonctions marchent (la valeur 'meetup' est utilisable après le COMMIT).
      const [{ id: plan }] = await q<{ id: string }>(
        A,
        `SELECT public.propose_meetup($1, '2027-02-05 18:00-05', '2027-02-05 19:00-05', 'Souper') AS id`,
        [gid],
      );
      await q(B, "SELECT public.respond_to_meetup($1, true)", [plan]);
      expect(await q(B, "SELECT title, source::text FROM busy_blocks ORDER BY source")).toEqual([
        { title: "Cours", source: "manual" },
        { title: "Souper", source: "meetup" },
      ]);
      // Un ancien plan ne reçoit plus de vote « peut-être », même par la fonction (yes/no).
      await expect(
        q(B, "INSERT INTO plan_votes (plan_id, vote) VALUES ($1, 'maybe')", [ancien]),
      ).rejects.toThrow(/permission denied/);

      // La relancer échoue sans rien casser (transaction).
      await expect(ancienne.exec(MIGRATION_0009)).rejects.toThrow(/already exists/);
      await ancienne.exec("ROLLBACK");
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Plans : revue de sécurité", () => {
  it("un titre ou un lieu avec des caractères de contrôle est refusé par la base", async () => {
    await expect(propose(A, { title: "Souper\rBEGIN:VALARM" })).rejects.toThrow(
      /meetup_plans_title_chars/,
    );
    await expect(propose(A, { location: "Parc\u0007" })).rejects.toThrow(
      /meetup_plans_location_chars/,
    );
    // Ce que le formulaire permet reste permis (tabulation, retour à la ligne, accents).
    expect(await propose(A, { title: "Souper\tchez « Léo »\nà 18 h" })).toBeTruthy();
  });

  it("le titre d'un plan n'est pas montré aux membres d'un AUTRE groupe, même titres visibles", async () => {
    // B montre ses titres ; B est aussi dans le groupe H avec D.
    await as(B, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [B]));
    const [h] = await as(B, () =>
      rows<{ id: string }>("SELECT public.create_group('Hockey') AS id"),
    );
    const [{ invite_code }] = await rows<{ invite_code: string }>(
      "SELECT invite_code FROM groups WHERE id = $1",
      [h.id],
    );
    await as(D, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
    await as(B, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday) VALUES ('Cours de chimie', '10:00', '12:00', 2)`,
      ),
    );
    const plan = await propose(A, { title: "Fête surprise pour Dan" });
    await respond(B, plan, true);

    const vusParD = await as(D, () =>
      rows<{ title: string; title_hidden: boolean }>(
        "SELECT title, title_hidden FROM public.group_busy_blocks($1) ORDER BY title",
        [h.id],
      ),
    );
    expect(vusParD).toEqual([
      { title: "Cours de chimie", title_hidden: false },
      { title: "Occupé", title_hidden: true },
    ]);
    // Dans le groupe du plan, rien ne change : les membres voient le titre que B montre.
    const vusParC = await as(C, () =>
      rows<{ title: string }>(
        "SELECT title FROM public.group_busy_blocks($1) WHERE owner_id = $2 ORDER BY title",
        [G, B],
      ),
    );
    expect(vusParC.map((r) => r.title)).toEqual(["Cours de chimie", "Fête surprise pour Dan"]);
  });
});
