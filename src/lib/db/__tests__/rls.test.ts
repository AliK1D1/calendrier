/**
 * Vérifie les migrations et la sécurité (RLS) sur une vraie base Postgres en mémoire (PGlite),
 * sans réseau. On recrée le strict minimum de Supabase : le schéma `auth` (table `auth.users`,
 * fonction `auth.uid()` qui lit le réglage `request.jwt.claim.sub`, comme Supabase) et les
 * rôles `anon` / `authenticated`. Puis on applique supabase/setup.sql tel quel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeparateMigrations, buildSetupSql } from "../../../../scripts/build-setup-sql.mjs";
import { parseIcs } from "@/lib/import/ics";
import { confirmIcsImport, type IcsConfirmInput, type IcsStore } from "@/lib/import/icsImport";
import type { BlockSpec } from "@/lib/scheduling/weeklyBlocks";
import { fromBlockSpec } from "../convert";
import { FAKE_SUPABASE } from "./pgliteHarness";

// Insère environ 1000 lignes dans PGlite : lent quand toute la suite tourne en parallèle.
const LONG_DB_TEST_MS = 30_000;

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");
const MIGRATION_0003 = readFileSync(join(ROOT, "supabase/migration-0003.sql"), "utf8");
const MIGRATION_0004 = readFileSync(join(ROOT, "supabase/migration-0004.sql"), "utf8");

/** SQL d'une migration Drizzle, sans les marqueurs de séparation. */
function drizzleSql(tag: string): string {
  return readFileSync(join(ROOT, "drizzle", `${tag}.sql`), "utf8").replace(
    /-->\s*statement-breakpoint/g,
    "",
  );
}

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

let db: PGlite;

/** Exécute `fn` en tant qu'utilisateur connecté `uid` (rôle authenticated), puis revient. */
async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "SET ROLE authenticated" : "SET ROLE anon");
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Crée un lieu et un bloc hebdomadaire pour l'utilisateur `uid`, en son nom. */
async function seedSchedule(uid: string, title: string) {
  return as(uid, async () => {
    const [place] = await rows<{ id: string }>(
      "INSERT INTO places (name, lat, lng) VALUES ($1, 45.5, -73.5) RETURNING id",
      [`Lieu de ${title}`],
    );
    await rows(
      `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
       VALUES ($1, $2, '10:00', '12:00', 1, '2025-08-25', '2025-12-19')`,
      [title, place.id],
    );
    return place.id;
  });
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
  // Base remise à zéro entre les tests (on garde le schéma).
  await db.exec("RESET ROLE; DELETE FROM auth.users; DELETE FROM public.groups;");
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ($1, 'ali@example.com', '{"full_name": "Ali"}'),
       ($2, 'sam@example.com', '{}'),
       ($3, 'zoe@example.com', '{"name": "Zoé"}')`,
    [A, B, C],
  );
});

async function createGroup(owner: string, name: string): Promise<{ id: string; code: string }> {
  return as(owner, async () => {
    const [{ id }] = await rows<{ id: string }>("SELECT public.create_group($1) AS id", [name]);
    const [g] = await rows<{ invite_code: string }>(
      "SELECT invite_code FROM groups WHERE id = $1",
      [id],
    );
    return { id, code: g.invite_code };
  });
}

async function join_(uid: string, code: string): Promise<string> {
  return as(uid, async () => {
    const [r] = await rows<{ gid: string }>("SELECT public.join_group_by_code($1) AS gid", [code]);
    return r.gid;
  });
}

describe("migrations (supabase/setup.sql)", () => {
  it("est à jour avec drizzle/*.sql (npm run db:setup-sql)", () => {
    expect(SETUP_SQL).toBe(buildSetupSql(ROOT));
  });

  it("supabase/migration-0002.sql à migration-0021.sql sont à jour (npm run db:setup-sql)", () => {
    const separees = buildSeparateMigrations(ROOT);
    expect(Object.keys(separees)).toEqual([
      "supabase/migration-0002.sql",
      "supabase/migration-0003.sql",
      "supabase/migration-0004.sql",
      "supabase/migration-0005.sql",
      "supabase/migration-0006.sql",
      "supabase/migration-0007.sql",
      "supabase/migration-0008.sql",
      "supabase/migration-0009.sql",
      "supabase/migration-0010.sql",
      "supabase/migration-0011.sql",
      "supabase/migration-0012.sql",
      "supabase/migration-0013.sql",
      "supabase/migration-0014.sql",
      "supabase/migration-0015.sql",
      "supabase/migration-0016.sql",
      "supabase/migration-0017.sql",
      "supabase/migration-0018.sql",
      "supabase/migration-0019.sql",
      "supabase/migration-0020.sql",
      "supabase/migration-0021.sql",
    ]);
    for (const [rel, content] of Object.entries(separees)) {
      expect(readFileSync(join(ROOT, rel), "utf8")).toBe(content);
    }
  });

  it("migration-0002 puis migration-0003 s'appliquent sur la base d'ali (setup.sql du segment 6 + données)", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      // État de la base d'ali : setup.sql du segment 6 (migrations 0000 et 0001).
      await ancienne.exec(drizzleSql("0000_schema"));
      await ancienne.exec(drizzleSql("0001_rls_triggers"));
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query(
        "INSERT INTO places (owner_id, name, lat, lng) VALUES ($1, 'Maison', 45.5, -73.5)",
        [A],
      );

      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0002.sql"), "utf8"));
      await ancienne.exec(MIGRATION_0003);

      const { rows: profils } = await ancienne.query<{ onboarded_at: string | null }>(
        "SELECT onboarded_at FROM profiles WHERE id = $1",
        [A],
      );
      // Un compte existant n'a pas encore vu l'accueil.
      expect(profils).toEqual([{ onboarded_at: null }]);
      const { rows: fns } = await ancienne.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'complete_onboarding'",
      );
      expect(fns[0].n).toBe(1);
      // La relancer échoue (colonne déjà là) sans rien casser : elle est transactionnelle.
      await expect(ancienne.exec(MIGRATION_0003)).rejects.toThrow(/already exists/);
      await ancienne.exec("ROLLBACK");
    } finally {
      await ancienne.close();
    }
  }, 60_000);

  it("migration-0005 s'applique sur une base en 0004, même avec une ligne trop longue (revue)", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query("UPDATE profiles SET display_name = $1 WHERE id = $2", [
        "n".repeat(70),
        A,
      ]);
      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0005.sql"), "utf8"));
      // L'ancienne ligne reste ; toute nouvelle écriture respecte la limite.
      await expect(
        ancienne.query("UPDATE profiles SET display_name = $1 WHERE id = $2", ["n".repeat(61), A]),
      ).rejects.toThrow(/profiles_display_name_length/);
    } finally {
      await ancienne.close();
    }
  });

  it("migration-0004 s'applique sur la base d'ali déjà en 0003, avec des données", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      // État actuel de la base d'ali : 0000 → 0003 appliquées, avec un compte, un lieu, un cours.
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      const { rows: lieux } = await ancienne.query<{ id: string }>(
        "INSERT INTO places (owner_id, name, lat, lng) VALUES ($1, 'Cégep', 45.5, -73.5) RETURNING id",
        [A],
      );
      await ancienne.query(
        `INSERT INTO busy_blocks (owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ($1, 'Chimie', $2, '10:00', '12:00', 1, '2025-08-25', '2025-12-19')`,
        [A, lieux[0].id],
      );
      await ancienne.query(
        "UPDATE profiles SET onboarded_at = now(), travel_mode = 'bike' WHERE id = $1",
        [A],
      );

      await ancienne.exec(MIGRATION_0004);

      const { rows: profils } = await ancienne.query<{
        travel_mode: string;
        unavailable_before: string | null;
        unavailable_after: string | null;
        accueilli: boolean;
      }>(
        "SELECT travel_mode, unavailable_before, unavailable_after, onboarded_at IS NOT NULL AS accueilli FROM profiles WHERE id = $1",
        [A],
      );
      // Données conservées ; pas de limite tant que la personne n'en choisit pas.
      expect(profils).toEqual([
        { travel_mode: "bike", unavailable_before: null, unavailable_after: null, accueilli: true },
      ]);
      const { rows: blocs } = await ancienne.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM busy_blocks",
      );
      expect(blocs[0].n).toBe(1);

      // La personne règle ses heures, en son nom (RLS) ; l'ordre est vérifié par la BD.
      await ancienne.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [A]);
      await ancienne.exec("SET ROLE authenticated");
      await ancienne.query(
        "UPDATE profiles SET unavailable_before = '09:00', unavailable_after = '22:00' WHERE id = $1",
        [A],
      );
      await expect(
        ancienne.query("UPDATE profiles SET unavailable_before = '23:00' WHERE id = $1", [A]),
      ).rejects.toThrow(/profiles_unavailable_order/);
      await ancienne.exec("RESET ROLE");

      // La relancer échoue (colonne déjà là) sans rien casser : elle est transactionnelle.
      await expect(ancienne.exec(MIGRATION_0004)).rejects.toThrow(/already exists/);
      await ancienne.exec("ROLLBACK");
      const { rows: apres } = await ancienne.query<{ b: string; a: string }>(
        "SELECT unavailable_before AS b, unavailable_after AS a FROM profiles WHERE id = $1",
        [A],
      );
      expect(apres).toEqual([{ b: "09:00:00", a: "22:00:00" }]);
    } finally {
      await ancienne.close();
    }
  }, 60_000);

  it("s'applique aussi avec le migrateur Drizzle (équivalent de drizzle-kit migrate)", async () => {
    const vide = new PGlite();
    try {
      await vide.exec(FAKE_SUPABASE);
      await migrate(drizzle(vide), { migrationsFolder: join(ROOT, "drizzle") });
      const { rows: policies } = await vide.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'",
      );
      expect(policies[0].n).toBe(40);
    } finally {
      await vide.close();
    }
  }, 60_000);

  it("s'applique sur une base vide et crée les 14 tables avec RLS activé", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(tables.map((t) => t.relname)).toEqual([
      "availability_slots",
      "busy_blocks",
      "calendar_subscriptions",
      "deadlines",
      "group_members",
      "groups",
      "meetup_plans",
      "outlook_connections",
      "places",
      "plan_invitees",
      "plan_votes",
      "profiles",
      "study_preferences",
      "subscription_events",
    ]);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
  });

  it("crée le profil à l'inscription (nom tiré des métadonnées ou du courriel)", async () => {
    const profils = await rows<{ id: string; display_name: string; travel_mode: string }>(
      "SELECT id, display_name, travel_mode FROM profiles ORDER BY id",
    );
    expect(profils).toEqual([
      { id: A, display_name: "Ali", travel_mode: "transit" },
      { id: B, display_name: "sam", travel_mode: "transit" },
      { id: C, display_name: "Zoé", travel_mode: "transit" },
    ]);
  });

  it("refuse un bloc ponctuel sans jour et un bloc qui finit avant de commencer", async () => {
    await expect(
      db.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time) VALUES ($1, 'x', '10:00', '11:00')`,
        [A],
      ),
    ).rejects.toThrow(/busy_blocks_one_off_has_day/);
    await expect(
      db.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday) VALUES ($1, 'x', '11:00', '10:00', 1)`,
        [A],
      ),
    ).rejects.toThrow(/busy_blocks_time_order/);
    // 24:00 est permis (bloc jusqu'à minuit).
    await db.query(
      `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday) VALUES ($1, 'soir', '22:00', '24:00', 5)`,
      [A],
    );
  });
});

describe("RLS : l'horaire (busy_blocks)", () => {
  it("A ne voit pas l'horaire de B s'ils ne partagent aucun groupe", async () => {
    await seedSchedule(A, "Chimie");
    await seedSchedule(B, "Travail de Sam");
    // B est dans un groupe, mais pas avec A.
    const g = await createGroup(B, "Amis de Sam");
    await join_(C, g.code);

    const seen = await as(A, () => rows<{ title: string }>("SELECT title FROM busy_blocks"));
    expect(seen.map((r) => r.title)).toEqual(["Chimie"]);

    const places = await as(A, () => rows<{ name: string }>("SELECT name FROM places"));
    expect(places.map((r) => r.name)).toEqual(["Lieu de Chimie"]);

    const profils = await as(A, () => rows<{ id: string }>("SELECT id FROM profiles"));
    expect(profils.map((r) => r.id)).toEqual([A]);
  });

  it("A voit l'horaire de B dès qu'ils partagent un groupe, et plus après l'avoir quitté", async () => {
    await seedSchedule(A, "Chimie");
    await seedSchedule(B, "Travail de Sam");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    // Par l'horaire du groupe (group_busy_blocks) ; titre de B masqué par défaut.
    const groupe = () =>
      as(A, () =>
        rows<{ owner_id: string; title: string }>(
          "SELECT owner_id, title FROM public.group_busy_blocks($1) ORDER BY title",
          [g.id],
        ),
      );
    expect(await groupe()).toEqual([
      { owner_id: A, title: "Chimie" },
      { owner_id: B, title: "Occupé" },
    ]);

    // C n'est pas dans le groupe : il ne voit ni A ni B, ni directement ni par la fonction.
    expect(await as(C, () => rows("SELECT * FROM busy_blocks"))).toEqual([]);
    expect(await as(C, () => rows("SELECT * FROM public.group_busy_blocks($1)", [g.id]))).toEqual(
      [],
    );

    // B quitte le groupe : A ne voit plus son horaire.
    await as(B, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, B]),
    );
    expect(await groupe()).toEqual([{ owner_id: A, title: "Chimie" }]);
  });

  it("A ne peut pas modifier, supprimer ni créer l'horaire de B, même dans le même groupe", async () => {
    await seedSchedule(A, "Chimie");
    await seedSchedule(B, "Travail de Sam");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    const updated = await as(
      A,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'piraté' WHERE owner_id = $1", [B]))
          .affectedRows,
    );
    expect(updated).toBe(0);

    const deleted = await as(
      A,
      async () => (await db.query("DELETE FROM busy_blocks WHERE owner_id = $1", [B])).affectedRows,
    );
    expect(deleted).toBe(0);

    await expect(
      as(A, () =>
        rows(
          `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday)
           VALUES ($1, 'faux', '08:00', '09:00', 2)`,
          [B],
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    // A ne peut pas non plus se donner l'horaire (changer owner_id) de B : depuis la
    // migration 0009, owner_id ne se modifie plus du tout (droits par colonne).
    await expect(
      as(A, () => rows("UPDATE busy_blocks SET owner_id = $1 WHERE owner_id = $2", [B, A])),
    ).rejects.toThrow(/permission denied/);

    const [{ title }] = await rows<{ title: string }>(
      "SELECT title FROM busy_blocks WHERE owner_id = $1",
      [B],
    );
    expect(title).toBe("Travail de Sam");
  });

  it("A ne peut pas placer un bloc dans un lieu de B", async () => {
    const lieuDeB = await seedSchedule(B, "Travail de Sam");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await expect(
      as(A, () =>
        rows(
          `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday)
           VALUES ('chez Sam', $1, '08:00', '09:00', 2)`,
          [lieuDeB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("un visiteur non connecté (anon) n'a accès à rien", async () => {
    await seedSchedule(A, "Chimie");
    await expect(as(null, () => rows("SELECT * FROM busy_blocks"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("RLS : groupes, profils, plans et votes", () => {
  it("un non-membre ne voit pas le groupe ni son code ; le code permet de rejoindre", async () => {
    const g = await createGroup(A, "Le cégep");
    expect(await as(B, () => rows("SELECT * FROM groups"))).toEqual([]);
    expect(await as(B, () => rows("SELECT * FROM group_members"))).toEqual([]);

    await expect(join_(B, "mauvais-code")).rejects.toThrow(/Code d'invitation invalide/);
    expect(await join_(B, g.code)).toBe(g.id);
    expect(await join_(B, g.code)).toBe(g.id); // idempotent

    const membres = await as(B, () =>
      rows<{ user_id: string; role: string }>(
        "SELECT user_id, role FROM group_members ORDER BY role",
      ),
    );
    expect(membres).toEqual([
      { user_id: A, role: "admin" },
      { user_id: B, role: "member" },
    ]);
  });

  it("on ne peut pas s'ajouter soi-même à un groupe sans le code", async () => {
    const g = await createGroup(A, "Le cégep");
    await expect(
      as(B, () => rows("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [g.id, B])),
    ).rejects.toThrow(/row-level security/);
  });

  it("seul l'admin retire un membre ; un membre ne retire pas l'admin", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    const parB = await as(
      B,
      async () =>
        (await db.query("DELETE FROM group_members WHERE user_id = $1", [A])).affectedRows,
    );
    expect(parB).toBe(0);
    const parA = await as(
      A,
      async () =>
        (await db.query("DELETE FROM group_members WHERE user_id = $1", [C])).affectedRows,
    );
    expect(parA).toBe(1);
  });

  it("on modifie seulement son propre profil, et la maison doit être un de ses lieux", async () => {
    const lieuDeB = await seedSchedule(B, "Travail de Sam");
    const lieuDeA = await seedSchedule(A, "Chimie");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    const autre = await as(
      A,
      async () =>
        (await db.query("UPDATE profiles SET display_name = 'x' WHERE id = $1", [B])).affectedRows,
    );
    expect(autre).toBe(0);

    await expect(
      as(A, () => rows("UPDATE profiles SET home_place_id = $1 WHERE id = $2", [lieuDeB, A])),
    ).rejects.toThrow(/row-level security/);

    const ok = await as(
      A,
      async () =>
        (
          await db.query(
            "UPDATE profiles SET home_place_id = $1, travel_mode = 'bike' WHERE id = $2",
            [lieuDeA, A],
          )
        ).affectedRows,
    );
    expect(ok).toBe(1);
  });

  it("plans et votes : visibles par le groupe, pas d'écriture directe (segment 12 : fonctions)", async () => {
    const lieuDeA = await seedSchedule(A, "Chimie");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    const [plan] = await as(A, () =>
      rows<{ id: string }>(
        `SELECT public.propose_meetup($1, now() + interval '1 day',
           now() + interval '1 day 1 hour', 'Étude', $2) AS id`,
        [g.id, lieuDeA],
      ),
    );
    // Écrire directement dans les tables des plans est refusé à tous (même membres).
    for (const sql of [
      `INSERT INTO meetup_plans (group_id, starts_at, ends_at)
       VALUES ('${g.id}', '2030-09-15 16:00-04', '2030-09-15 17:00-04')`,
      `INSERT INTO plan_votes (plan_id, vote) VALUES ('${plan.id}', 'yes')`,
      `INSERT INTO plan_invitees (plan_id, user_id) VALUES ('${plan.id}', '${C}')`,
      `UPDATE meetup_plans SET status = 'confirmed'`,
      `DELETE FROM plan_votes`,
    ]) {
      await expect(as(B, () => rows(sql))).rejects.toThrow(/permission denied/);
    }
    // C (hors groupe) ne voit pas le plan.
    expect(await as(C, () => rows("SELECT * FROM meetup_plans"))).toEqual([]);

    await as(B, () => rows("SELECT public.respond_to_meetup($1, true)", [plan.id]));
    const votes = await as(A, () =>
      rows<{ user_id: string; vote: string }>(
        "SELECT user_id, vote FROM plan_votes ORDER BY user_id",
      ),
    );
    expect(votes).toEqual([
      { user_id: A, vote: "yes" },
      { user_id: B, vote: "yes" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Revue sécurité : un admin ne doit pas pouvoir ajouter quelqu'un de force
// ---------------------------------------------------------------------------

describe("RLS : revue sécurité des modifications d'appartenance", () => {
  it("un admin ne peut pas réécrire une ligne de membre pour y mettre un inconnu", async () => {
    await seedSchedule(C, "Horaire privé de Zoé");
    const g = await createGroup(A, "Groupe de A");
    const g2 = await createGroup(A, "Second groupe de A");

    // Tentative : déplacer sa propre ligne de g2 vers g en remplaçant son id par celui de C.
    const attempt = as(A, () =>
      db.query("UPDATE group_members SET group_id = $1, user_id = $2 WHERE group_id = $3", [
        g.id,
        C,
        g2.id,
      ]),
    );
    await expect(attempt).rejects.toThrow(/permission denied/);

    const seen = await as(A, () =>
      rows<{ title: string }>("SELECT title FROM busy_blocks WHERE owner_id = $1", [C]),
    );
    expect(seen).toEqual([]);
  });

  it("un admin ne peut pas changer le user_id d'un membre pour y mettre un inconnu", async () => {
    await seedSchedule(C, "Horaire privé de Zoé");
    const g = await createGroup(A, "Groupe de A");
    await join_(B, g.code);
    await expect(
      as(A, () =>
        db.query("UPDATE group_members SET user_id = $1 WHERE group_id = $2 AND user_id = $3", [
          C,
          g.id,
          B,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    const membres = await rows<{ user_id: string }>(
      "SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY user_id",
      [g.id],
    );
    expect(membres.map((m) => m.user_id)).toEqual([A, B]);
    const seen = await as(A, () => rows("SELECT title FROM busy_blocks WHERE owner_id = $1", [C]));
    expect(seen).toEqual([]);
  });

  it("un admin ne peut pas changer le créateur d'un groupe ; il peut le renommer", async () => {
    const g = await createGroup(A, "Groupe de A");
    await expect(
      as(A, () => db.query("UPDATE groups SET created_by = $1 WHERE id = $2", [C, g.id])),
    ).rejects.toThrow(/permission denied/);
    const renamed = await as(
      A,
      async () =>
        (await db.query("UPDATE groups SET name = 'Nouveau nom' WHERE id = $1", [g.id]))
          .affectedRows,
    );
    expect(renamed).toBe(1);
  });

  it("l'admin peut encore changer le rôle d'un membre, un membre non", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    const parA = await as(
      A,
      async () =>
        (
          await db.query(
            "UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2",
            [g.id, B],
          )
        ).affectedRows,
    );
    expect(parA).toBe(1);
    const parC = await as(
      C,
      async () =>
        (
          await db.query(
            "UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2",
            [g.id, C],
          )
        ).affectedRows,
    );
    expect(parC).toBe(0);
  });

  it("anon ne peut exécuter aucune fonction de l'app", async () => {
    for (const fn of [
      "is_group_member(gen_random_uuid())",
      "is_group_admin(gen_random_uuid())",
      "shares_group_with(gen_random_uuid())",
      "join_group_by_code('x')",
    ]) {
      await expect(as(null, () => db.query(`SELECT public.${fn}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("Mes lieux : accueil (complete_onboarding) et lieux", () => {
  type Profil = { travel_mode: string; home_place_id: string | null; onboarded_at: string | null };
  const profilDe = (uid: string) =>
    rows<Profil>("SELECT travel_mode, home_place_id, onboarded_at FROM profiles WHERE id = $1", [
      uid,
    ]).then((r) => r[0]);
  const lieuxDe = (uid: string) =>
    rows<{ id: string; name: string; lat: number; lng: number }>(
      "SELECT id, name, lat, lng FROM places WHERE owner_id = $1 ORDER BY created_at, name",
      [uid],
    );

  it("enregistre maison + cégep + mode en une fois, et seulement la première fois", async () => {
    expect((await profilDe(A)).onboarded_at).toBeNull();
    const [r] = await as(A, () =>
      rows<{ ok: boolean }>(
        `SELECT public.complete_onboarding(
           home_name => $1, home_lat => 45.52, home_lng => -73.48,
           school_name => $2, school_lat => 45.535936, school_lng => -73.49389,
           mode => 'bike') AS ok`,
        ["Maison", "Cégep Édouard-Montpetit"],
      ),
    );
    expect(r.ok).toBe(true);

    const lieux = await lieuxDe(A);
    expect(lieux.map((l) => l.name).sort()).toEqual(["Cégep Édouard-Montpetit", "Maison"]);
    const profil = await profilDe(A);
    expect(profil.travel_mode).toBe("bike");
    expect(profil.onboarded_at).not.toBeNull();
    expect(profil.home_place_id).toBe(lieux.find((l) => l.name === "Maison")?.id);

    // Double envoi du formulaire : rien de plus.
    const [again] = await as(A, () =>
      rows<{ ok: boolean }>(
        "SELECT public.complete_onboarding(home_name => 'Maison', home_lat => 1, home_lng => 1) AS ok",
      ),
    );
    expect(again.ok).toBe(false);
    expect(await lieuxDe(A)).toHaveLength(2);
  });

  it("« passer » marque seulement le profil", async () => {
    await as(A, () => rows("SELECT public.complete_onboarding()"));
    const profil = await profilDe(A);
    expect(profil).toMatchObject({ travel_mode: "transit", home_place_id: null });
    expect(profil.onboarded_at).not.toBeNull();
    expect(await lieuxDe(A)).toEqual([]);
  });

  it("tout ou rien : un cégep invalide n'enregistre pas la maison non plus", async () => {
    await expect(
      as(A, () =>
        rows(
          `SELECT public.complete_onboarding(
             home_name => 'Maison', home_lat => 45.5, home_lng => -73.5,
             school_name => 'Cégep', school_lat => 95, school_lng => -73.5)`,
        ),
      ),
    ).rejects.toThrow(/places_lat_range/);
    expect(await lieuxDe(A)).toEqual([]);
    expect((await profilDe(A)).onboarded_at).toBeNull();
  });

  it("un visiteur non connecté ne peut pas l'appeler", async () => {
    await expect(as(null, () => rows("SELECT public.complete_onboarding()"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("n'agit que sur le profil de la personne connectée (RLS)", async () => {
    await as(B, () =>
      rows(
        "SELECT public.complete_onboarding(home_name => 'Chez Sam', home_lat => 45.6, home_lng => -73.6)",
      ),
    );
    expect((await profilDe(A)).onboarded_at).toBeNull();
    expect(await lieuxDe(A)).toEqual([]);
    expect((await lieuxDe(B)).map((l) => l.name)).toEqual(["Chez Sam"]);
  });

  it("lieux : ajouter, renommer, choisir la maison, supprimer (la maison se vide)", async () => {
    const [lieu] = await as(A, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng) VALUES ('Cégep', 45.535936, -73.49389) RETURNING id",
      ),
    );
    await as(A, () => rows("UPDATE places SET name = 'Mon cégep' WHERE id = $1", [lieu.id]));
    await as(A, () => rows("UPDATE profiles SET home_place_id = $1 WHERE id = $2", [lieu.id, A]));
    expect((await lieuxDe(A))[0].name).toBe("Mon cégep");
    expect((await profilDe(A)).home_place_id).toBe(lieu.id);

    // B (même groupe) voit le lieu mais ne peut ni le renommer ni le supprimer.
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    const renomme = await as(
      B,
      async () => (await db.query("UPDATE places SET name = 'piraté'")).affectedRows,
    );
    const supprime = await as(B, async () => (await db.query("DELETE FROM places")).affectedRows);
    expect([renomme, supprime]).toEqual([0, 0]);

    await as(A, () => rows("DELETE FROM places WHERE id = $1", [lieu.id]));
    expect(await lieuxDe(A)).toEqual([]);
    expect((await profilDe(A)).home_place_id).toBeNull();
  });

  it("refuse un nom de lieu de plus de 100 caractères", async () => {
    await expect(
      as(A, () =>
        rows("INSERT INTO places (name, lat, lng) VALUES ($1, 45.5, -73.5)", ["x".repeat(101)]),
      ),
    ).rejects.toThrow(/places_name_length/);
  });
});

describe("Mon horaire : blocs manuels et heures où je ne sors pas", () => {
  it("j'ajoute, modifie et supprime mes blocs ; B (même groupe) les voit sans pouvoir y toucher", async () => {
    const lieu = await seedSchedule(A, "Chimie");
    // Deux jours d'un coup (lundi et mercredi), comme le formulaire.
    const ajoutes = await as(A, () =>
      rows<{ id: string; source: string }>(
        `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ('Physique', $1, '13:00', '15:00', 1, '2025-08-25', '2025-12-19'),
                ('Physique', $1, '13:00', '15:00', 3, '2025-08-25', '2025-12-19')
         RETURNING id, source`,
        [lieu],
      ),
    );
    expect(ajoutes.map((b) => b.source)).toEqual(["manual", "manual"]);
    await as(A, () =>
      rows("UPDATE busy_blocks SET end_time = '15:30' WHERE id = $1 AND owner_id = $2", [
        ajoutes[0].id,
        A,
      ]),
    );
    const g = await createGroup(A, "Gang");
    await join_(B, g.code);
    // A choisit de montrer ses titres : B les voit par l'horaire du groupe.
    await as(A, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]));
    const vus = await as(B, () =>
      rows<{ title: string }>(
        "SELECT title FROM public.group_busy_blocks($1) WHERE owner_id = $2 ORDER BY title",
        [g.id, A],
      ),
    );
    expect(vus.map((v) => v.title)).toEqual(["Chimie", "Physique", "Physique"]);
    const touche = await as(
      B,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'x' WHERE owner_id = $1", [A]))
          .affectedRows,
    );
    expect(touche).toBe(0);
    await as(A, () => rows("DELETE FROM busy_blocks WHERE id = $1", [ajoutes[1].id]));
    const restants = await rows<{ end_time: string }>(
      "SELECT end_time FROM busy_blocks WHERE owner_id = $1 AND title = 'Physique'",
      [A],
    );
    expect(restants).toEqual([{ end_time: "15:30:00" }]);
  });

  it("heures où je ne sors pas : seulement sur mon profil, visibles par mon groupe, ordre vérifié", async () => {
    await as(A, () =>
      rows(
        "UPDATE profiles SET unavailable_before = '09:00', unavailable_after = '22:00' WHERE id = $1",
        [A],
      ),
    );
    const autre = await as(
      B,
      async () =>
        (await db.query("UPDATE profiles SET unavailable_before = '12:00' WHERE id = $1", [A]))
          .affectedRows,
    );
    expect(autre).toBe(0);
    await expect(
      as(A, () =>
        rows(
          "UPDATE profiles SET unavailable_before = '22:00', unavailable_after = '09:00' WHERE id = $1",
          [A],
        ),
      ),
    ).rejects.toThrow(/profiles_unavailable_order/);
    const g = await createGroup(A, "Gang");
    await join_(B, g.code);
    const vu = await as(B, () =>
      rows<{ b: string; a: string }>(
        "SELECT unavailable_before AS b, unavailable_after AS a FROM profiles WHERE id = $1",
        [A],
      ),
    );
    expect(vu).toEqual([{ b: "09:00:00", a: "22:00:00" }]);
  });
});

// ---------------------------------------------------------------------------
// Revue sécurité : la BD applique les mêmes limites que les formulaires
// ---------------------------------------------------------------------------
// La clé « anon » est publique : une personne connectée peut écrire directement dans
// Supabase (API REST) sans passer par les actions serveur et leur validation.

describe("Contraintes : limites appliquées aussi par la base (revue)", () => {
  it("refuse un titre de bloc de plus de 100 caractères, écrit directement", async () => {
    await expect(
      as(A, () =>
        db.query(
          `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, valid_until)
           VALUES ($1, '10:00', '12:00', 1, '2025-08-25', '2025-12-19')`,
          ["x".repeat(101)],
        ),
      ),
    ).rejects.toThrow(/busy_blocks_title_length/);
    // 100 caractères : permis (même limite que le formulaire).
    await as(A, () =>
      db.query(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ($1, '10:00', '12:00', 1, '2025-08-25', '2025-12-19')`,
        ["x".repeat(100)],
      ),
    );
  });

  it("refuse une session de plus de 366 jours et un nom affiché de plus de 60 caractères", async () => {
    await expect(
      as(A, () =>
        db.query(
          `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, valid_until)
           VALUES ('Chimie', '10:00', '12:00', 1, '2025-01-01', '2099-12-31')`,
        ),
      ),
    ).rejects.toThrow(/busy_blocks_validity_span/);
    await expect(
      as(A, () =>
        db.query("UPDATE profiles SET display_name = $1 WHERE id = $2", ["n".repeat(61), A]),
      ),
    ).rejects.toThrow(/profiles_display_name_length/);
    const ok = await as(
      A,
      async () =>
        (await db.query("UPDATE profiles SET display_name = $1 WHERE id = $2", ["n".repeat(60), A]))
          .affectedRows,
    );
    expect(ok).toBe(1);
  });

  it("l'inscription marche encore avec un nom Google de plus de 60 caractères (coupé)", async () => {
    const D = "00000000-0000-4000-8000-00000000000d";
    await db.query(
      "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'long@example.com', $2)",
      [D, JSON.stringify({ full_name: "N".repeat(80) })],
    );
    const [p] = await rows<{ display_name: string }>(
      "SELECT display_name FROM profiles WHERE id = $1",
      [D],
    );
    expect(p.display_name).toBe("N".repeat(60));
  });
});

// ─── Segment 9 : import .ics ────────────────────────────────────────────────────────────────

/**
 * Magasin de l'import .ics sur PGlite : mêmes requêtes que celles que supabase-js envoie
 * (src/app/horaire/import-actions.ts), au nom de `uid` (rôle authenticated, donc RLS).
 */
function pgliteIcsStore(uid: string): IcsStore {
  const fail = (e: unknown) => ({ ok: false as const, error: (e as Error).message });
  return {
    async countIcsBlocks() {
      const [r] = await as(uid, () =>
        rows<{ n: number }>(
          "SELECT count(*)::int AS n FROM busy_blocks WHERE owner_id = $1 AND source = 'ics'",
          [uid],
        ),
      );
      return { ok: true, value: r.n };
    },
    async createPlaces(places) {
      try {
        const ids = places.map(() => crypto.randomUUID());
        await as(uid, () =>
          rows(
            `INSERT INTO places (id, owner_id, name, lat, lng)
             SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::float8[], $5::float8[])`,
            [
              ids,
              places.map(() => uid),
              places.map((p) => p.name),
              places.map((p) => p.lat),
              places.map((p) => p.lng),
            ],
          ),
        );
        return { ok: true, value: ids };
      } catch (e) {
        return fail(e);
      }
    },
    async deletePlaces(ids) {
      await as(uid, () =>
        rows("DELETE FROM places WHERE owner_id = $1 AND id = ANY($2::uuid[])", [uid, ids]),
      );
      return { ok: true, value: undefined };
    },
    async insertIcsBlocks(blocks: BlockSpec[]) {
      // Une seule requête INSERT de plusieurs lignes, comme PostgREST : tout ou rien.
      const params: unknown[] = [];
      const values = blocks.map((b) => {
        const r = fromBlockSpec(b);
        const cols = [
          uid,
          r.title,
          r.place_id,
          r.start_time,
          r.end_time,
          r.weekday,
          r.valid_from,
          r.valid_until,
        ];
        const ph = cols.map((v) => `$${params.push(v)}`);
        return `(${ph.join(", ")}, 'ics')`;
      });
      try {
        const res = await as(uid, () =>
          rows<{ created_at: string }>(
            `INSERT INTO busy_blocks (owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, source)
             VALUES ${values.join(", ")} RETURNING created_at::text`,
            params,
          ),
        );
        return { ok: true, value: { createdAt: res[0].created_at } };
      } catch (e) {
        return fail(e);
      }
    },
    async deleteIcsBlocksBefore(createdAt) {
      const res = await as(uid, () =>
        rows(
          "DELETE FROM busy_blocks WHERE owner_id = $1 AND source = 'ics' AND created_at < $2::timestamptz RETURNING id",
          [uid, createdAt],
        ),
      );
      return { ok: true, value: res.length };
    },
  };
}

const ICS_FIXTURE = readFileSync(
  join(ROOT, "src/lib/import/__tests__/fixtures/horaire-hiver-2027.ics"),
  "utf8",
);

/** Confirmation de l'aperçu du fichier d'exemple, tous les lieux associés à `placeId`. */
function icsConfirmation(placeId: string | null): IcsConfirmInput {
  const r = parseIcs(ICS_FIXTURE, { today: "2026-11-02" });
  if (!r.ok) throw new Error(r.error);
  return {
    blocks: r.value.blocks.map(
      ({ title, startMinute, endMinute, weekday, validFrom, validUntil, locationText }) => ({
        title,
        startMinute,
        endMinute,
        weekday,
        validFrom,
        validUntil,
        locationText,
      }),
    ),
    places: r.value.locations.map((l) => ({
      locationText: l,
      choice: placeId ? { kind: "place" as const, id: placeId } : { kind: "home" as const },
    })),
  };
}

async function blocksOf(uid: string) {
  return rows<{
    title: string;
    source: string;
    weekday: number | null;
    valid_from: string;
    valid_until: string;
  }>(
    `SELECT title, source::text, weekday, valid_from::text, valid_until::text FROM busy_blocks
     WHERE owner_id = $1 ORDER BY source, title, weekday, valid_from`,
    [uid],
  );
}

describe("Import .ics : remplacement des blocs source='ics' (PGlite)", () => {
  it("importe le fichier d'exemple, puis un ré-import remplace sans doublon ni toucher au reste", async () => {
    const cegep = await seedSchedule(A, "Manuel"); // bloc « manual » à garder
    await seedSchedule(B, "De B");
    await as(B, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source)
         VALUES ('Ancien import de B', '09:00', '10:00', '2027-01-04', 'ics')`,
      ),
    );
    await as(A, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source)
         VALUES ('Ancien import', '09:00', '10:00', '2027-01-04', 'ics')`,
      ),
    );

    const premier = await confirmIcsImport(pgliteIcsStore(A), icsConfirmation(cegep));
    expect(premier).toEqual({ ok: true, imported: 13, replaced: 1, placesCreated: 0 });
    let mine = await blocksOf(A);
    expect(mine.filter((b) => b.source === "manual").map((b) => b.title)).toEqual(["Manuel"]);
    expect(mine.filter((b) => b.source === "ics")).toHaveLength(13);
    expect(mine.some((b) => b.title === "Ancien import")).toBe(false);
    // La relâche coupe la chimie du lundi en deux blocs.
    expect(
      mine
        .filter((b) => b.title === "Chimie générale" && b.weekday === 1)
        .map((b) => [b.valid_from, b.valid_until]),
    ).toEqual([
      ["2027-01-18", "2027-02-22"],
      ["2027-03-08", "2027-05-10"],
    ]);

    const second = await confirmIcsImport(pgliteIcsStore(A), icsConfirmation(cegep));
    expect(second).toEqual({ ok: true, imported: 13, replaced: 13, placesCreated: 0 });
    mine = await blocksOf(A);
    expect(mine.filter((b) => b.source === "ics")).toHaveLength(13);
    expect(mine.filter((b) => b.source === "manual")).toHaveLength(1);
    // L'horaire de B (manuel et importé) n'a pas bougé.
    expect((await blocksOf(B)).map((b) => b.title)).toEqual(["Ancien import de B", "De B"]);
  });

  it("crée les nouveaux lieux et y place les blocs", async () => {
    const input = icsConfirmation(null);
    input.places = input.places.map((p) => ({
      locationText: p.locationText,
      choice: { kind: "new" as const, name: p.locationText, lat: 45.56, lng: -73.72 },
    }));
    const r = await confirmIcsImport(pgliteIcsStore(A), input);
    expect(r).toEqual({ ok: true, imported: 13, replaced: 0, placesCreated: 4 });
    const parLieu = await rows<{ name: string; n: number }>(
      `SELECT p.name, count(*)::int AS n FROM busy_blocks b JOIN places p ON p.id = b.place_id
       WHERE b.owner_id = $1 GROUP BY p.name ORDER BY p.name`,
      [A],
    );
    expect(parLieu).toEqual([
      { name: "Café Le Grain, Laval", n: 1 },
      { name: "Cégep Montmorency, gymnase", n: 2 },
      { name: "Cégep Montmorency, local A-110", n: 2 },
      { name: "Cégep Montmorency, local B-201", n: 8 },
    ]);
  });

  it("si la BD refuse un bloc (lieu de B), rien n'est importé et l'ancien horaire reste", async () => {
    const lieuDeB = await seedSchedule(B, "De B");
    await as(A, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source)
         VALUES ('Ancien import', '09:00', '10:00', '2027-01-04', 'ics')`,
      ),
    );
    const input = icsConfirmation(null);
    input.places.push({
      locationText: "Chez B",
      choice: { kind: "new", name: "x", lat: 1, lng: 1 },
    });
    input.places[0] = {
      locationText: input.places[0].locationText,
      choice: { kind: "place", id: lieuDeB },
    };
    const r = await confirmIcsImport(pgliteIcsStore(A), input);
    expect(r.ok).toBe(false);
    expect((await blocksOf(A)).map((b) => b.title)).toEqual(["Ancien import"]);
    expect(await rows("SELECT 1 FROM places WHERE owner_id = $1", [A])).toEqual([]);
  });

  it("insertion de plusieurs lignes : tout ou rien (contrainte titre ≤ 100 de la migration 0005)", async () => {
    const store = pgliteIcsStore(A);
    const ok: BlockSpec = {
      title: "Bon",
      placeId: null,
      startMinute: 600,
      endMinute: 660,
      weekday: null,
      validFrom: "2027-01-04",
      validUntil: "2027-01-04",
    };
    const r = await store.insertIcsBlocks([ok, { ...ok, title: "x".repeat(101) }]);
    expect(r.ok).toBe(false);
    expect(await blocksOf(A)).toEqual([]);
  });

  it("la suppression des anciens blocs ne touche jamais l'horaire d'une autre personne (RLS)", async () => {
    const g = await createGroup(A, "Gang");
    await join_(B, g.code);
    await as(B, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source)
         VALUES ('Import de B', '09:00', '10:00', '2027-01-04', 'ics')`,
      ),
    );
    // Même sans le filtre owner_id, la politique DELETE limite A à ses propres lignes.
    const supprimes = await as(A, () =>
      rows(
        "DELETE FROM busy_blocks WHERE source = 'ics' AND created_at < now() + interval '1 day' RETURNING id",
      ),
    );
    expect(supprimes).toEqual([]);
    expect((await blocksOf(B)).map((b) => b.title)).toEqual(["Import de B"]);
  });
});

// ---------------------------------------------------------------------------
// Segment 10 : groupes et amis (migration 0006). Deux comptes A et B, plus C hors groupe.
// Les requêtes directes sur les tables reproduisent ce que permet l'API REST de Supabase
// avec la clé anon et le jeton d'un membre (sans passer par l'app).
// ---------------------------------------------------------------------------

describe("Groupes (segment 10) : confidentialité de l'horaire", () => {
  it("par défaut, un membre voit « Occupé » et le lieu, jamais le titre, même en lisant la table directement", async () => {
    const lieuDeA = await seedSchedule(A, "Chimie organique");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    // Requête directe (équivalent REST : GET /rest/v1/busy_blocks?owner_id=eq.A) : rien.
    expect(
      await as(B, () => rows("SELECT title FROM busy_blocks WHERE owner_id = $1", [A])),
    ).toEqual([]);
    expect(await as(B, () => rows("SELECT * FROM busy_blocks"))).toEqual([]);

    // Par l'horaire du groupe : « Occupé », le lieu et les heures.
    const vus = await as(B, () =>
      rows<{ title: string; title_hidden: boolean; place_id: string; start_time: string }>(
        "SELECT title, title_hidden, place_id, start_time FROM public.group_busy_blocks($1) WHERE owner_id = $2",
        [g.id, A],
      ),
    );
    expect(vus).toEqual([
      { title: "Occupé", title_hidden: true, place_id: lieuDeA, start_time: "10:00:00" },
    ]);
    // Le lieu général est lisible par le membre.
    expect(await as(B, () => rows("SELECT name FROM places WHERE id = $1", [lieuDeA]))).toEqual([
      { name: "Lieu de Chimie organique" },
    ]);
    // A voit toujours ses propres titres, même par la fonction.
    expect(
      await as(A, () =>
        rows("SELECT title FROM public.group_busy_blocks($1) WHERE owner_id = $2", [g.id, A]),
      ),
    ).toEqual([{ title: "Chimie organique" }]);
    // B ne peut pas désactiver l'option à la place de A.
    const parB = await as(
      B,
      async () =>
        (await db.query("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]))
          .affectedRows,
    );
    expect(parB).toBe(0);
  });

  it("si A désactive l'option, les membres voient ses titres ; un groupe dont on n'est pas membre ne renvoie rien", async () => {
    await seedSchedule(A, "Chimie");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    const autre = await createGroup(C, "Groupe de Zoé");
    await as(A, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]));
    expect(
      await as(B, () =>
        rows("SELECT title, title_hidden FROM public.group_busy_blocks($1)", [g.id]),
      ),
    ).toEqual([{ title: "Chimie", title_hidden: false }]);
    // B demande l'horaire d'un groupe dont il n'est pas membre : rien.
    await seedSchedule(C, "Secret de Zoé");
    expect(
      await as(B, () => rows("SELECT * FROM public.group_busy_blocks($1)", [autre.id])),
    ).toEqual([]);
    // Toujours rien en lecture directe.
    expect(await as(B, () => rows("SELECT * FROM busy_blocks"))).toEqual([]);
  });
});

describe("Groupes (segment 10) : créer, inviter, rejoindre", () => {
  it("parcours à deux comptes : A crée, partage le code, B rejoint ; C ne voit rien sans le lien", async () => {
    const g = await createGroup(A, "  Le cégep  ");
    expect(g.code).toMatch(/^[0-9a-f]{32}$/);
    const [grp] = await as(A, () =>
      rows<{ name: string }>("SELECT name FROM groups WHERE id = $1", [g.id]),
    );
    expect(grp.name).toBe("Le cégep");

    // C, sans le code : ni le groupe, ni les membres, ni leurs profils.
    for (const uid of [B, C]) {
      expect(await as(uid, () => rows("SELECT * FROM groups"))).toEqual([]);
      expect(await as(uid, () => rows("SELECT * FROM group_members"))).toEqual([]);
      expect(await as(uid, () => rows("SELECT id FROM profiles WHERE id = $1", [A]))).toEqual([]);
    }
    // Un faux code (même bien formé) ne révèle rien et ne fait rien rejoindre.
    const faux = "0".repeat(32);
    expect(
      await as(C, () => rows("SELECT * FROM public.group_invite_preview($1)", [faux])),
    ).toEqual([]);
    await expect(join_(C, faux)).rejects.toThrow(/Code d'invitation invalide/);
    // Ni insertion directe dans group_members ni dans groups.
    await expect(
      as(C, () => rows("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [g.id, C])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(C, () => rows("INSERT INTO groups (name, created_by) VALUES ('x', $1)", [C])),
    ).rejects.toThrow(/permission denied/);

    // B a le lien : aperçu, puis rejoindre (le code est insensible à la casse et aux espaces).
    expect(
      await as(B, () =>
        rows("SELECT name, member_count, already_member FROM public.group_invite_preview($1)", [
          ` ${g.code.toUpperCase()} `,
        ]),
      ),
    ).toEqual([{ name: "Le cégep", member_count: 1, already_member: false }]);
    expect(await join_(B, g.code)).toBe(g.id);
    const membres = await as(B, () =>
      rows<{ user_id: string; role: string }>(
        "SELECT user_id, role FROM group_members ORDER BY role",
      ),
    );
    expect(membres).toEqual([
      { user_id: A, role: "admin" },
      { user_id: B, role: "member" },
    ]);
    expect(
      (await as(B, () => rows<{ id: string }>("SELECT id FROM profiles ORDER BY id"))).map(
        (p) => p.id,
      ),
    ).toEqual([A, B]);
    // C ne voit toujours rien.
    expect(await as(C, () => rows("SELECT * FROM groups"))).toEqual([]);
  });

  it("seul l'admin régénère le code ; l'ancien lien ne marche plus ; personne ne choisit le code", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await expect(
      as(B, () => rows("SELECT public.regenerate_invite_code($1)", [g.id])),
    ).rejects.toThrow(/Réservé à l'admin/);
    await expect(
      as(C, () => rows("SELECT public.regenerate_invite_code($1)", [g.id])),
    ).rejects.toThrow(/Réservé à l'admin/);
    // Même l'admin ne peut pas écrire un code à la main (code faible ou deviné).
    await expect(
      as(A, () => rows("UPDATE groups SET invite_code = 'abc' WHERE id = $1", [g.id])),
    ).rejects.toThrow(/permission denied/);

    const [{ code }] = await as(A, () =>
      rows<{ code: string }>("SELECT public.regenerate_invite_code($1) AS code", [g.id]),
    );
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(code).not.toBe(g.code);
    await expect(join_(C, g.code)).rejects.toThrow(/Code d'invitation invalide/);
    expect(await join_(C, code)).toBe(g.id);
  });

  it("refuse un nom de groupe vide ou de plus de 60 caractères", async () => {
    await expect(createGroup(A, "   ")).rejects.toThrow(/groups_name_not_blank/);
    await expect(createGroup(A, "n".repeat(61))).rejects.toThrow(/groups_name_length/);
  });

  it("le créateur qui a quitté ne voit plus le groupe ni son code", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await as(A, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, A]),
    );
    expect(await as(A, () => rows("SELECT * FROM groups"))).toEqual([]);
    expect(await as(A, () => rows("SELECT * FROM group_members"))).toEqual([]);
  });
});

describe("Groupes : un membre retiré ne revient pas avec l'ancien lien (revue)", () => {
  const codeDe = async (uid: string, gid: string) =>
    (
      await as(uid, () =>
        rows<{ invite_code: string }>("SELECT invite_code FROM groups WHERE id = $1", [gid]),
      )
    )[0]?.invite_code;
  const retirer = (par: string, gid: string, uid: string) =>
    as(par, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [gid, uid]),
    );

  it("retiré par l'admin : l'ancien lien ne marche plus, ni pour lui ni pour les autres", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    await retirer(A, g.id, C);
    // Avant la revue, C revenait aussitôt avec le lien qu'il avait vu comme membre.
    await expect(join_(C, g.code)).rejects.toThrow(/Code d'invitation invalide/);
    await expect(
      as(C, () => rows("SELECT * FROM public.group_invite_preview($1)", [g.code])),
    ).resolves.toEqual([]);
    const nouveau = await codeDe(A, g.id);
    expect(nouveau).toMatch(/^[0-9a-f]{32}$/);
    expect(nouveau).not.toBe(g.code);
    expect(await codeDe(B, g.id)).toBe(nouveau); // les membres voient le nouveau lien
  });

  it("quitter soi-même le groupe ne change pas le lien ; supprimer un compte non plus", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    await retirer(B, g.id, B);
    expect(await codeDe(A, g.id)).toBe(g.code);
    expect(await join_(B, g.code)).toBe(g.id); // B peut revenir s'il le veut
    await db.query("DELETE FROM auth.users WHERE id = $1", [C]);
    expect(await codeDe(A, g.id)).toBe(g.code);
  });

  it("le dernier admin retiré par un autre admin : promotion et nouveau lien", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    await as(A, () =>
      rows("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [
        g.id,
        B,
      ]),
    );
    await retirer(B, g.id, A);
    const membres = await rows<{ user_id: string; role: string }>(
      "SELECT user_id, role FROM group_members WHERE group_id = $1 ORDER BY user_id",
      [g.id],
    );
    expect(membres).toEqual([
      { user_id: B, role: "admin" },
      { user_id: C, role: "member" },
    ]);
    await expect(join_(A, g.code)).rejects.toThrow(/Code d'invitation invalide/);
  });
});

describe("Limites de nombre de lieux et de blocs (revue)", () => {
  const ajouterBlocs = (uid: string, n: number) =>
    as(uid, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday)
         SELECT 'Cours', '10:00', '11:00', 1 FROM generate_series(1, $1)`,
        [n],
      ),
    );
  const ajouterLieux = (uid: string, n: number, groupId: string | null = null) =>
    as(uid, () =>
      rows(
        `INSERT INTO places (name, lat, lng, group_id, is_group_favorite)
         SELECT 'Lieu', 45.5, -73.5, $2::uuid, $2::uuid IS NOT NULL FROM generate_series(1, $1)`,
        [n, groupId],
      ),
    );

  it(
    "1000 blocs par personne au plus ; les autres ne sont pas touchés",
    async () => {
      await ajouterBlocs(A, 1000);
      await expect(ajouterBlocs(A, 1)).rejects.toThrow(/Trop de blocs dans l'horaire/);
      await ajouterBlocs(B, 5);
      await as(A, () =>
        rows("DELETE FROM busy_blocks WHERE ctid IN (SELECT ctid FROM busy_blocks LIMIT 1)"),
      );
      await ajouterBlocs(A, 1);
    },
    LONG_DB_TEST_MS,
  );

  it("200 lieux par personne et 100 lieux par groupe au plus, même en déplaçant un lieu", async () => {
    await ajouterLieux(A, 200);
    await expect(ajouterLieux(A, 1)).rejects.toThrow(/Trop de lieux \(200/);
    const g = await createGroup(B, "Le cégep");
    await join_(C, g.code);
    await ajouterLieux(B, 60, g.id);
    await ajouterLieux(C, 40, g.id);
    await expect(ajouterLieux(C, 1, g.id)).rejects.toThrow(/Trop de lieux dans ce groupe/);
    const [perso] = await as(C, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng) VALUES ('Parc', 45.5, -73.5) RETURNING id",
      ),
    );
    await expect(
      as(C, () =>
        rows("UPDATE places SET group_id = $1, is_group_favorite = true WHERE id = $2", [
          g.id,
          perso.id,
        ]),
      ),
    ).rejects.toThrow(/Trop de lieux dans ce groupe/);
    // Renommer un lieu du groupe reste permis à la limite.
    await as(B, () => rows("UPDATE places SET name = 'Café' WHERE group_id = $1", [g.id]));
  });
});

describe("Groupes (segment 10) : quitter et retirer", () => {
  const membresDe = (gid: string) =>
    rows<{ user_id: string; role: string }>(
      "SELECT user_id, role FROM group_members WHERE group_id = $1 ORDER BY joined_at, user_id",
      [gid],
    );

  it("un membre se retire ; l'admin retire un autre membre ; un membre ne retire personne", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    const parB = await as(
      B,
      async () =>
        (
          await db.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
            g.id,
            C,
          ])
        ).affectedRows,
    );
    expect(parB).toBe(0);
    const parA = await as(
      A,
      async () =>
        (
          await db.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
            g.id,
            C,
          ])
        ).affectedRows,
    );
    expect(parA).toBe(1);
    const depart = await as(
      B,
      async () =>
        (
          await db.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
            g.id,
            B,
          ])
        ).affectedRows,
    );
    expect(depart).toBe(1);
    expect(await membresDe(g.id)).toEqual([{ user_id: A, role: "admin" }]);
    // C, retiré, ne voit plus rien et doit avoir le code pour revenir.
    expect(await as(C, () => rows("SELECT * FROM groups"))).toEqual([]);
  });

  it("le dernier admin qui part : le membre le plus ancien devient admin", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await join_(C, g.code);
    await as(A, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, A]),
    );
    expect(await membresDe(g.id)).toEqual([
      { user_id: B, role: "admin" },
      { user_id: C, role: "member" },
    ]);
  });

  it("le dernier admin ne peut pas se rétrograder ; un autre admin d'abord, puis oui", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await expect(
      as(A, () =>
        rows("UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2", [
          g.id,
          A,
        ]),
      ),
    ).rejects.toThrow(/au moins un admin/);
    await as(A, () =>
      rows("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [
        g.id,
        B,
      ]),
    );
    await as(A, () =>
      rows("UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2", [
        g.id,
        A,
      ]),
    );
    expect(await membresDe(g.id)).toEqual([
      { user_id: A, role: "member" },
      { user_id: B, role: "admin" },
    ]);
  });

  it("supprimer un compte (cascade) passe par les mêmes règles sans erreur", async () => {
    const g = await createGroup(B, "Groupe de Sam");
    await join_(A, g.code);
    await join_(C, g.code);
    const h = await createGroup(C, "Groupe de Zoé");
    await join_(B, h.code);
    // B (admin et créateur de g, simple membre de h) supprime son compte.
    await db.query("DELETE FROM auth.users WHERE id = $1", [B]);
    // g disparaît avec son créateur (clé étrangère) ; h garde C comme admin.
    expect(await rows("SELECT id FROM groups WHERE id = $1", [g.id])).toEqual([]);
    expect(await membresDe(h.id)).toEqual([{ user_id: C, role: "admin" }]);
  });

  it("le dernier membre qui part : le groupe est supprimé avec ses lieux favoris", async () => {
    const g = await createGroup(A, "Solo");
    await as(A, () =>
      rows(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Café', 45.5, -73.5, $1, true)",
        [g.id],
      ),
    );
    await as(A, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, A]),
    );
    expect(await rows("SELECT id FROM groups WHERE id = $1", [g.id])).toEqual([]);
    expect(await rows("SELECT id FROM places WHERE group_id = $1", [g.id])).toEqual([]);
  });
});

describe("Groupes (segment 10) : lieux favoris du groupe", () => {
  it("seuls les membres voient et ajoutent ; pas de rattachement à un groupe dont on n'est pas membre", async () => {
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    // C partage un AUTRE groupe avec A : il voit les lieux perso de A, pas les favoris de g.
    const h = await createGroup(C, "Autre");
    await join_(A, h.code);
    await seedSchedule(A, "Chimie");

    const [cafe] = await as(A, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Café Lune', 45.5, -73.5, $1, true) RETURNING id",
        [g.id],
      ),
    );
    await as(B, () =>
      rows(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Parc', 45.5, -73.5, $1, true)",
        [g.id],
      ),
    );
    const favorisVus = (uid: string) =>
      as(uid, () =>
        rows<{ name: string }>("SELECT name FROM places WHERE group_id = $1 ORDER BY name", [g.id]),
      );
    expect((await favorisVus(A)).map((p) => p.name)).toEqual(["Café Lune", "Parc"]);
    expect((await favorisVus(B)).map((p) => p.name)).toEqual(["Café Lune", "Parc"]);
    expect(await favorisVus(C)).toEqual([]);
    expect(
      (await as(C, () => rows<{ name: string }>("SELECT name FROM places ORDER BY name"))).map(
        (p) => p.name,
      ),
    ).toEqual(["Lieu de Chimie"]);

    // C ne peut pas rattacher un lieu à g, ni à l'ajout ni en modifiant un de ses lieux.
    await expect(
      as(C, () =>
        rows(
          "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Intrus', 45.5, -73.5, $1, true)",
          [g.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const [lieuDeC] = await as(C, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng) VALUES ('Chez Zoé', 45.5, -73.5) RETURNING id",
      ),
    );
    await expect(
      as(C, () =>
        rows("UPDATE places SET group_id = $1, is_group_favorite = true WHERE id = $2", [
          g.id,
          lieuDeC.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    // Le lien et le drapeau vont ensemble.
    await expect(
      as(A, () =>
        rows("INSERT INTO places (name, lat, lng, group_id) VALUES ('x', 45.5, -73.5, $1)", [g.id]),
      ),
    ).rejects.toThrow(/places_group_favorite_link/);

    // B (simple membre) ne supprime pas le favori de A ; A (admin) supprime celui de B.
    const parB = await as(
      B,
      async () => (await db.query("DELETE FROM places WHERE id = $1", [cafe.id])).affectedRows,
    );
    expect(parB).toBe(0);
    const parA = await as(
      A,
      async () =>
        (await db.query("DELETE FROM places WHERE group_id = $1 AND name = 'Parc'", [g.id]))
          .affectedRows,
    );
    expect(parA).toBe(1);

    // B quitte : il ne voit plus les favoris.
    await as(B, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, B]),
    );
    expect(await favorisVus(B)).toEqual([]);
  });

  it("un plan ne peut pas utiliser le lieu favori d'un autre groupe", async () => {
    const g = await createGroup(A, "G");
    const h = await createGroup(A, "H");
    await join_(B, g.code);
    await join_(
      B,
      (
        await as(A, () =>
          rows<{ c: string }>("SELECT invite_code AS c FROM groups WHERE id = $1", [h.id]),
        )
      )[0].c,
    );
    const [cafe] = await as(A, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Café', 45.5, -73.5, $1, true) RETURNING id",
        [g.id],
      ),
    );
    const propose = (gid: string) =>
      as(A, () =>
        rows(
          `SELECT public.propose_meetup($1, now() + interval '2 days',
             now() + interval '2 days 1 hour', 'Café', $2)`,
          [gid, cafe.id],
        ),
      );
    await expect(propose(h.id)).rejects.toThrow(/Lieu introuvable/);
    await propose(g.id);
  });

  it("anon ne peut exécuter aucune des nouvelles fonctions", async () => {
    for (const fn of [
      "group_busy_blocks(gen_random_uuid())",
      "create_group('x')",
      "regenerate_invite_code(gen_random_uuid())",
      "group_invite_preview('x')",
    ]) {
      await expect(as(null, () => db.query(`SELECT * FROM public.${fn}`))).rejects.toThrow(
        /permission denied/,
      );
    }
    const { rows: publics } = await db.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (has_function_privilege('anon', p.oid, 'EXECUTE'))
       ORDER BY 1`,
    );
    expect(publics).toEqual([]);
  });
});

describe("Groupes (segment 10) : migration 0006 sur une base en 0005 avec des données", () => {
  it("s'applique, remplace les codes courts, garde les données et coupe la lecture directe des horaires", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query(
        "INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com'), ($2, 'sam@example.com')",
        [A, B],
      );
      const { rows: lieux } = await ancienne.query<{ id: string }>(
        "INSERT INTO places (owner_id, name, lat, lng, is_group_favorite) VALUES ($1, 'Cégep', 45.5, -73.5, true) RETURNING id",
        [A],
      );
      await ancienne.query(
        `INSERT INTO busy_blocks (owner_id, title, place_id, start_time, end_time, weekday)
         VALUES ($1, 'Chimie', $2, '10:00', '12:00', 1)`,
        [A, lieux[0].id],
      );
      const { rows: groupes } = await ancienne.query<{ id: string; invite_code: string }>(
        "INSERT INTO groups (name, created_by) VALUES ('Gang', $1) RETURNING id, invite_code",
        [A],
      );
      expect(groupes[0].invite_code).toHaveLength(12);
      await ancienne.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [
        groupes[0].id,
        B,
      ]);

      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0006.sql"), "utf8"));

      const { rows: apres } = await ancienne.query<{ invite_code: string; name: string }>(
        "SELECT invite_code, name FROM groups",
      );
      expect(apres).toHaveLength(1);
      expect(apres[0].name).toBe("Gang");
      expect(apres[0].invite_code).toMatch(/^[0-9a-f]{32}$/);
      const { rows: p } = await ancienne.query<{ fav: boolean; gid: string | null }>(
        "SELECT is_group_favorite AS fav, group_id AS gid FROM places",
      );
      expect(p).toEqual([{ fav: false, gid: null }]);
      const { rows: profils } = await ancienne.query<{ h: boolean }>(
        "SELECT hide_block_titles AS h FROM profiles ORDER BY id",
      );
      expect(profils).toEqual([{ h: true }, { h: true }]);
      const { rows: membres } = await ancienne.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM group_members",
      );
      expect(membres[0].n).toBe(2);

      // B (membre) ne lit plus directement le bloc de A, mais le voit « Occupé » par la fonction.
      await ancienne.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [B]);
      await ancienne.exec("SET ROLE authenticated");
      expect((await ancienne.query("SELECT * FROM busy_blocks")).rows).toEqual([]);
      expect(
        (await ancienne.query("SELECT title FROM public.group_busy_blocks($1)", [groupes[0].id]))
          .rows,
      ).toEqual([{ title: "Occupé" }]);
      await ancienne.exec("RESET ROLE");

      // La relancer échoue (colonne déjà là) sans rien casser : elle est transactionnelle.
      await expect(
        ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0006.sql"), "utf8")),
      ).rejects.toThrow(/already exists/);
      await ancienne.exec("ROLLBACK");
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Disponibilités ponctuelles (segment 18) : RLS, droits, limites", () => {
  /** Ajoute une disponibilité au nom de `uid`, `offset` jours après aujourd'hui (UTC de la BD). */
  async function addSlot(uid: string, offset = 3, start = "13:00", end = "18:00", note = "") {
    return as(uid, async () => {
      const [r] = await rows<{ id: string }>(
        `INSERT INTO availability_slots (day, start_time, end_time, note)
         VALUES (current_date + $1::int, $2, $3, $4) RETURNING id`,
        [offset, start, end, note],
      );
      return r.id;
    });
  }

  it("seule la personne voit, modifie et supprime ses disponibilités ; personne n'écrit pour elle", async () => {
    const id = await addSlot(A, 3, "13:00", "18:00", "pas de shift");
    expect(await as(A, () => rows("SELECT note FROM availability_slots"))).toEqual([
      { note: "pas de shift" },
    ]);
    expect(await as(B, () => rows("SELECT * FROM availability_slots"))).toEqual([]);
    expect(
      await as(B, () =>
        rows("UPDATE availability_slots SET note = 'x' WHERE id = $1 RETURNING id", [id]),
      ),
    ).toEqual([]);
    expect(
      await as(B, () => rows("DELETE FROM availability_slots WHERE id = $1 RETURNING id", [id])),
    ).toEqual([]);
    await expect(
      as(B, () =>
        rows(
          "INSERT INTO availability_slots (owner_id, day, start_time, end_time) VALUES ($1, current_date + 2, '10:00', '11:00')",
          [A],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // A modifie les heures et la note, mais ni le propriétaire ni l'identifiant.
    await as(A, () =>
      rows("UPDATE availability_slots SET end_time = '24:00', note = 'ok' WHERE id = $1", [id]),
    );
    await expect(
      as(A, () => rows("UPDATE availability_slots SET owner_id = $1 WHERE id = $2", [B, id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(A, () => rows("UPDATE availability_slots SET created_at = now() WHERE id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
    expect(
      await as(A, () => rows("DELETE FROM availability_slots WHERE id = $1 RETURNING id", [id])),
    ).toEqual([{ id }]);
  });

  it("anon ne lit rien et n'exécute pas group_availability_slots", async () => {
    await addSlot(A);
    await expect(as(null, () => rows("SELECT * FROM availability_slots"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(null, () =>
        rows("SELECT * FROM public.group_availability_slots($1)", [
          "00000000-0000-4000-8000-000000000099",
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("CHECK : au moins 15 min, note d'une ligne de 60 caractères au plus", async () => {
    await expect(addSlot(A, 3, "13:00", "13:10")).rejects.toThrow(/availability_slots_time_order/);
    await expect(addSlot(A, 3, "18:00", "13:00")).rejects.toThrow(/availability_slots_time_order/);
    await expect(addSlot(A, 3, "13:00", "18:00", "x".repeat(61))).rejects.toThrow(
      /availability_slots_note_length/,
    );
    for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0085b", "a\u001bb"]) {
      await expect(addSlot(A, 3, "13:00", "18:00", bad)).rejects.toThrow(
        /availability_slots_note_chars/,
      );
    }
    await addSlot(A, 3, "20:00", "24:00", "é".repeat(60));
  });

  it("jour entre hier et dans un an ; 100 disponibilités par personne au plus", async () => {
    await expect(addSlot(A, -3)).rejects.toThrow(/année qui vient/);
    await expect(addSlot(A, 400)).rejects.toThrow(/année qui vient/);
    await as(A, () =>
      rows(
        `INSERT INTO availability_slots (day, start_time, end_time)
         SELECT current_date + (g % 300), '10:00', '11:00' FROM generate_series(1, 100) g`,
      ),
    );
    await expect(addSlot(A)).rejects.toThrow(/100 au maximum/);
    // Les autres ne sont pas touchés.
    await addSlot(B);
    // Les disponibilités passées ne comptent pas (sinon on serait bloqué au bout d'un an).
    await db.exec("ALTER TABLE availability_slots DISABLE TRIGGER availability_slots_limits");
    await db.query(
      `INSERT INTO availability_slots (owner_id, day, start_time, end_time)
       SELECT $1, current_date - 5 - g, '10:00', '11:00' FROM generate_series(1, 150) g`,
      [C],
    );
    await db.exec("ALTER TABLE availability_slots ENABLE TRIGGER availability_slots_limits");
    await addSlot(C);
  });

  it("revue 18.1 : ramener une vieille disponibilité dans l'année qui vient compte dans les 100", async () => {
    // Avant : la limite n'était vérifiée qu'à l'ajout. En gardant ses disponibilités passées,
    // puis en changeant leur jour, on dépassait 100 sans limite (100 de plus chaque jour).
    await as(A, () =>
      rows(
        `INSERT INTO availability_slots (day, start_time, end_time)
         SELECT current_date + (g % 300), '10:00', '11:00' FROM generate_series(1, 100) g`,
      ),
    );
    // Le temps passe : 5 disponibilités de A sont maintenant dans le passé.
    await db.exec("ALTER TABLE availability_slots DISABLE TRIGGER availability_slots_limits");
    await db.query(
      `INSERT INTO availability_slots (owner_id, day, start_time, end_time)
       SELECT $1, current_date - 5 - g, '10:00', '11:00' FROM generate_series(1, 5) g`,
      [A],
    );
    await db.exec("ALTER TABLE availability_slots ENABLE TRIGGER availability_slots_limits");
    await expect(
      as(A, () =>
        rows("UPDATE availability_slots SET day = current_date + 2 WHERE day < current_date - 1"),
      ),
    ).rejects.toThrow(/100 au maximum/);
    const [{ n }] = await as(A, () =>
      rows<{ n: number }>(
        "SELECT count(*)::int AS n FROM availability_slots WHERE day >= current_date - 1",
      ),
    );
    expect(n).toBe(100);
    // Ce qui marchait avant marche encore : changer le jour ou les heures d'une disponibilité
    // à venir, même à 100, et modifier la note d'une vieille.
    await as(A, () =>
      rows(
        "UPDATE availability_slots SET day = day + 1, start_time = '09:00' WHERE id = (SELECT id FROM availability_slots WHERE day >= current_date ORDER BY day LIMIT 1)",
      ),
    );
    await as(A, () =>
      rows("UPDATE availability_slots SET note = 'vieux' WHERE day < current_date - 1"),
    );
    // Sous la limite, ramener une vieille disponibilité est permis.
    await as(A, () =>
      rows(
        "DELETE FROM availability_slots WHERE id IN (SELECT id FROM availability_slots WHERE day >= current_date ORDER BY day LIMIT 3)",
      ),
    );
    expect(
      await as(A, () =>
        rows(
          "UPDATE availability_slots SET day = current_date + 2 WHERE id IN (SELECT id FROM availability_slots WHERE day < current_date - 1 LIMIT 3) RETURNING id",
        ),
      ),
    ).toHaveLength(3);
  });

  it("les membres d'un groupe voient le jour et les heures (jamais la note) ; les autres, rien", async () => {
    await addSlot(A, 3, "13:00", "18:00", "secret");
    await addSlot(C, 3, "09:00", "10:00");
    // Une vieille disponibilité (écrite avant la limite) n'est plus renvoyée.
    await db.exec("ALTER TABLE availability_slots DISABLE TRIGGER availability_slots_limits");
    await db.query(
      "INSERT INTO availability_slots (owner_id, day, start_time, end_time) VALUES ($1, current_date - 10, '10:00', '11:00')",
      [A],
    );
    await db.exec("ALTER TABLE availability_slots ENABLE TRIGGER availability_slots_limits");

    const g = await createGroup(A, "Gang");
    await join_(B, g.code);
    const vu = await as(B, () =>
      rows<Record<string, unknown>>("SELECT * FROM public.group_availability_slots($1)", [g.id]),
    );
    expect(vu).toHaveLength(1);
    expect(Object.keys(vu[0]).sort()).toEqual(["day", "end_time", "id", "owner_id", "start_time"]);
    expect(vu[0]).toMatchObject({ owner_id: A, start_time: "13:00:00", end_time: "18:00:00" });
    // C n'est pas membre : rien, même en connaissant l'identifiant du groupe.
    expect(
      await as(C, () => rows("SELECT * FROM public.group_availability_slots($1)", [g.id])),
    ).toEqual([]);
  });
});

describe("Disponibilités ponctuelles : migration 0012 sur une base en 0011 avec des données", () => {
  it("s'applique seule (supabase/migration-0012.sql) et garde les données", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
        "0006_groups",
        "0007_review_kick_new_code",
        "0008_review_row_limits",
        "0009_segment12_meetup_invites",
        "0010_review_plan_privacy",
        "0011_segment13_study_planner",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday)
         VALUES ($1, 'Chimie', '10:00', '12:00', 1)`,
        [A],
      );
      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0012.sql"), "utf8"));
      const { rows: blocs } = await ancienne.query("SELECT title FROM busy_blocks");
      expect(blocs).toEqual([{ title: "Chimie" }]);
      const { rows: rls } = await ancienne.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = 'availability_slots'",
      );
      expect(rls).toEqual([{ relrowsecurity: true }]);
      // Deuxième passage : échoue sans rien changer (« already exists »).
      await expect(
        ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0012.sql"), "utf8")),
      ).rejects.toThrow(/already exists/);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Revue 18.1 : migration 0013 sur une base en 0012 avec des données", () => {
  it("s'applique seule (supabase/migration-0013.sql), garde les données, et peut être relancée", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
        "0006_groups",
        "0007_review_kick_new_code",
        "0008_review_row_limits",
        "0009_segment12_meetup_invites",
        "0010_review_plan_privacy",
        "0011_segment13_study_planner",
        "0012_segment18_availability_slots",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query(
        `INSERT INTO availability_slots (owner_id, day, start_time, end_time, note)
         VALUES ($1, current_date + 3, '13:00', '18:00', 'pas de shift')`,
        [A],
      );
      const migration = readFileSync(join(ROOT, "supabase/migration-0013.sql"), "utf8");
      await ancienne.exec(migration);
      await ancienne.exec(migration);
      const { rows: dispos } = await ancienne.query("SELECT note FROM availability_slots");
      expect(dispos).toEqual([{ note: "pas de shift" }]);
      const { rows: droits } = await ancienne.query<{ ok: boolean }>(
        "SELECT has_function_privilege('authenticated', 'public.enforce_availability_limits()', 'EXECUTE') AS ok",
      );
      expect(droits).toEqual([{ ok: false }]);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Connecteur Outlook (migration 0014) : jeton privé, blocs « Occupé », déconnexion", () => {
  const OUTLOOK_BLOCKS = JSON.stringify([
    { day: "2026-11-04", start: "10:00", end: "11:30" },
    { day: "2026-11-05", start: "22:00", end: "24:00" },
  ]);

  async function connect(uid: string, token = "v1.chiffre") {
    await as(uid, () =>
      rows(
        "INSERT INTO outlook_connections (owner_id, account_email, refresh_token_enc) VALUES ($1, 'x@outlook.com', $2)",
        [uid, token],
      ),
    );
  }

  it("la connexion (et son jeton chiffré) n'est visible que par la personne", async () => {
    await connect(A);
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    expect(await as(A, () => rows("SELECT refresh_token_enc FROM outlook_connections"))).toEqual([
      { refresh_token_enc: "v1.chiffre" },
    ]);
    // Même un membre du groupe ne voit rien, ne modifie rien, ne supprime rien.
    expect(await as(B, () => rows("SELECT * FROM outlook_connections"))).toEqual([]);
    const maj = await as(
      B,
      async () =>
        (
          await db.query(
            "UPDATE outlook_connections SET refresh_token_enc = 'pirate' WHERE owner_id = $1",
            [A],
          )
        ).affectedRows,
    );
    expect(maj).toBe(0);
    const del = await as(
      B,
      async () =>
        (await db.query("DELETE FROM outlook_connections WHERE owner_id = $1", [A])).affectedRows,
    );
    expect(del).toBe(0);
    // Personne ne crée une connexion au nom d'un autre ; un visiteur anonyme ne lit rien.
    await as(A, () => rows("DELETE FROM outlook_connections"));
    await expect(
      as(B, () =>
        rows("INSERT INTO outlook_connections (owner_id, refresh_token_enc) VALUES ($1, 'x')", [A]),
      ),
    ).rejects.toThrow();
    await expect(as(null, () => rows("SELECT * FROM outlook_connections"))).rejects.toThrow();
  });

  it("replace_outlook_blocks remplace tous les blocs Outlook, sans titre ni lieu", async () => {
    await connect(A);
    await seedSchedule(A, "Chimie");
    await as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS]));
    const [{ n }] = await as(A, () =>
      rows<{ n: number }>("SELECT public.replace_outlook_blocks($1::jsonb) AS n", [OUTLOOK_BLOCKS]),
    );
    expect(n).toBe(2);
    expect(
      await as(A, () =>
        rows(
          "SELECT title, place_id, start_time, end_time, weekday, valid_from::text AS valid_from, source FROM busy_blocks WHERE source = 'outlook' ORDER BY valid_from",
        ),
      ),
    ).toEqual([
      {
        title: "Outlook",
        place_id: null,
        start_time: "10:00:00",
        end_time: "11:30:00",
        weekday: null,
        valid_from: "2026-11-04",
        source: "outlook",
      },
      {
        title: "Outlook",
        place_id: null,
        start_time: "22:00:00",
        end_time: "24:00:00",
        weekday: null,
        valid_from: "2026-11-05",
        source: "outlook",
      },
    ]);
    // Les autres blocs ne sont pas touchés.
    expect(
      await as(A, () => rows("SELECT title FROM busy_blocks WHERE source <> 'outlook'")),
    ).toEqual([{ title: "Chimie" }]);
  });

  it("un bloc refusé annule tout (les anciens restent) ; au plus 500 ; seulement si connecté", async () => {
    await connect(A);
    await as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS]));
    const invalide = JSON.stringify([
      { day: "2026-11-06", start: "09:00", end: "10:00" },
      { day: "2026-11-06", start: "12:00", end: "11:00" },
    ]);
    await expect(
      as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [invalide])),
    ).rejects.toThrow();
    const trop = JSON.stringify(
      Array.from({ length: 501 }, () => ({ day: "2026-11-06", start: "09:00", end: "10:00" })),
    );
    await expect(
      as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [trop])),
    ).rejects.toThrow(/500 au maximum/);
    expect(
      await as(A, () =>
        rows("SELECT count(*)::int AS n FROM busy_blocks WHERE source = 'outlook'"),
      ),
    ).toEqual([{ n: 2 }]);
    // B n'a pas connecté Outlook : refusé.
    await expect(
      as(B, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS])),
    ).rejects.toThrow(/pas connecté/);
    await expect(
      as(null, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS])),
    ).rejects.toThrow();
  });

  it("les blocs Outlook ne se créent, modifient ni suppriment à la main", async () => {
    await connect(A);
    await as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS]));
    await expect(
      as(A, () =>
        rows(
          "INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source) VALUES ('x', '08:00', '09:00', '2026-11-07', 'outlook')",
        ),
      ),
    ).rejects.toThrow();
    const maj = await as(
      A,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'x' WHERE source = 'outlook'"))
          .affectedRows,
    );
    const del = await as(
      A,
      async () => (await db.query("DELETE FROM busy_blocks WHERE source = 'outlook'")).affectedRows,
    );
    expect([maj, del]).toEqual([0, 0]);
    // Un bloc Outlook est toujours ponctuel et sans lieu (contrainte, même pour la BD).
    await expect(
      db.query(
        "INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday, source) VALUES ($1, 'x', '08:00', '09:00', 1, 'outlook')",
        [A],
      ),
    ).rejects.toThrow(/busy_blocks_outlook_one_off/);
  });

  it("les membres du groupe voient « Occupé », même si A montre ses titres", async () => {
    await connect(A);
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await as(A, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]));
    await as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS]));
    expect(
      await as(B, () =>
        rows(
          "SELECT title, title_hidden, start_time FROM public.group_busy_blocks($1) WHERE owner_id = $2 ORDER BY valid_from",
          [g.id, A],
        ),
      ),
    ).toEqual([
      { title: "Occupé", title_hidden: true, start_time: "10:00:00" },
      { title: "Occupé", title_hidden: true, start_time: "22:00:00" },
    ]);
  });

  it("claim_outlook_sync : réserve, puis « busy », puis « recent » ; « none » sans connexion", async () => {
    expect(await as(A, () => rows("SELECT public.claim_outlook_sync(15) AS r"))).toEqual([
      { r: { status: "none" } },
    ]);
    await connect(A);
    const [{ r }] = await as(A, () =>
      rows<{ r: Record<string, unknown> }>("SELECT public.claim_outlook_sync(15) AS r"),
    );
    expect(r).toEqual({ status: "ok", refresh_token_enc: "v1.chiffre", calendar_id: null });
    expect(await as(A, () => rows("SELECT public.claim_outlook_sync(1) AS r"))).toEqual([
      { r: { status: "busy" } },
    ]);
    await as(A, () => rows("UPDATE outlook_connections SET sync_started_at = NULL"));
    expect(await as(A, () => rows("SELECT public.claim_outlook_sync(15) AS r"))).toEqual([
      { r: { status: "recent" } },
    ]);
    // B ne réserve jamais la synchro de A (il n'a pas de connexion à lui).
    expect(await as(B, () => rows("SELECT public.claim_outlook_sync(0) AS r"))).toEqual([
      { r: { status: "none" } },
    ]);
  });

  it("déconnexion : la connexion et tous les blocs Outlook sont supprimés, le reste gardé", async () => {
    await connect(A);
    await seedSchedule(A, "Chimie");
    await as(A, () => rows("SELECT public.replace_outlook_blocks($1::jsonb)", [OUTLOOK_BLOCKS]));
    await as(A, () => rows("SELECT public.disconnect_outlook()"));
    expect(await as(A, () => rows("SELECT * FROM outlook_connections"))).toEqual([]);
    expect(await as(A, () => rows("SELECT title, source FROM busy_blocks"))).toEqual([
      { title: "Chimie", source: "manual" },
    ]);
  });

  it("migration 0014 seule sur une base en 0013 avec des données", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
        "0006_groups",
        "0007_review_kick_new_code",
        "0008_review_row_limits",
        "0009_segment12_meetup_invites",
        "0010_review_plan_privacy",
        "0011_segment13_study_planner",
        "0012_segment18_availability_slots",
        "0013_review_availability_limit",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query(
        "INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday) VALUES ($1, 'Chimie', '10:00', '12:00', 1)",
        [A],
      );
      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0014.sql"), "utf8"));
      const { rows: blocs } = await ancienne.query("SELECT title FROM busy_blocks");
      expect(blocs).toEqual([{ title: "Chimie" }]);
      const { rows: droits } = await ancienne.query<{ ok: boolean }>(
        "SELECT has_function_privilege('anon', 'public.replace_outlook_blocks(jsonb)', 'EXECUTE') AS ok",
      );
      expect(droits).toEqual([{ ok: false }]);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Répétition personnalisée (story 2, migration 0015)", () => {
  it("j'enregistre « toutes les 2 semaines » et « chaque mois » ; le groupe reçoit la répétition", async () => {
    await as(A, () =>
      rows(
        `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, repeat_unit, repeat_every)
         VALUES ('Club', '18:00', '20:00', 2, '2026-11-05', 'week', 2),
                ('Loyer', '09:00', '10:00', NULL, '2026-01-31', 'month', 1)`,
      ),
    );
    await as(A, () =>
      rows("UPDATE busy_blocks SET repeat_every = 3 WHERE title = 'Club' AND owner_id = $1", [A]),
    );
    const g = await createGroup(A, "Gang");
    await join_(B, g.code);
    const vus = await as(B, () =>
      rows<{ repeat_unit: string | null; repeat_every: number; valid_until: string | null }>(
        `SELECT repeat_unit, repeat_every, valid_until FROM public.group_busy_blocks($1)
         WHERE owner_id = $2 ORDER BY repeat_unit`,
        [g.id, A],
      ),
    );
    expect(vus).toEqual([
      { repeat_unit: "month", repeat_every: 1, valid_until: null },
      { repeat_unit: "week", repeat_every: 3, valid_until: null },
    ]);
  });

  it("la base refuse un X hors 1..99, une forme incohérente et une répétition hors « manuel »", async () => {
    const insert = (cols: string, vals: string) =>
      db.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, ${cols})
                VALUES ($1, 'x', '10:00', '11:00', ${vals})`,
        [A],
      );
    await expect(
      insert("weekday, valid_from, repeat_unit, repeat_every", "1, '2026-11-02', 'week', 0"),
    ).rejects.toThrow(/busy_blocks_repeat_every_range/);
    await expect(
      insert("weekday, valid_from, repeat_unit, repeat_every", "1, '2026-11-02', 'week', 100"),
    ).rejects.toThrow(/busy_blocks_repeat_every_range/);
    // Intervalle sans unité, « mois » avec un jour de semaine, « semaine » sans début.
    await expect(insert("weekday, valid_from, repeat_every", "1, '2026-11-02', 2")).rejects.toThrow(
      /busy_blocks_repeat_shape/,
    );
    await expect(
      insert("weekday, valid_from, repeat_unit", "1, '2026-11-02', 'month'"),
    ).rejects.toThrow(/busy_blocks_repeat_shape/);
    await expect(insert("weekday, repeat_unit", "1, 'week'")).rejects.toThrow(
      /busy_blocks_repeat_shape/,
    );
    await expect(insert("valid_from, repeat_unit", "'2026-11-02', 'siècle'")).rejects.toThrow(
      /busy_blocks_repeat_shape/,
    );
    await expect(
      insert("weekday, valid_from, repeat_unit, source", "1, '2026-11-02', 'week', 'ics'"),
    ).rejects.toThrow(/busy_blocks_repeat_manual/);
    // 10 ans au plus avec une date de fin ; un hebdomadaire simple garde la limite d'un an.
    await expect(
      insert("valid_from, valid_until, repeat_unit", "'2026-11-02', '2036-12-01', 'month'"),
    ).rejects.toThrow(/busy_blocks_validity_span/);
    await insert("valid_from, valid_until, repeat_unit", "'2026-11-02', '2030-11-02', 'month'");
    await expect(
      insert("weekday, valid_from, valid_until", "1, '2026-11-02', '2028-11-02'"),
    ).rejects.toThrow(/busy_blocks_validity_span/);
  });

  it("migration 0015 seule sur une base en 0014 avec des données", async () => {
    const ancienne = new PGlite();
    try {
      await ancienne.exec(FAKE_SUPABASE);
      for (const tag of [
        "0000_schema",
        "0001_rls_triggers",
        "0002_review_hardening",
        "0003_onboarding",
        "0004_quiet_hours",
        "0005_review_limits",
        "0006_groups",
        "0007_review_kick_new_code",
        "0008_review_row_limits",
        "0009_segment12_meetup_invites",
        "0010_review_plan_privacy",
        "0011_segment13_study_planner",
        "0012_segment18_availability_slots",
        "0013_review_availability_limit",
        "0014_outlook_connector",
      ]) {
        await ancienne.exec(drizzleSql(tag));
      }
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      await ancienne.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ($1, 'Chimie', '10:00', '12:00', 1, '2026-08-24', '2026-12-18'),
                ($1, 'Dentiste', '09:00', '10:00', NULL, '2026-11-20', '2026-11-20')`,
        [A],
      );
      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0015.sql"), "utf8"));
      const { rows: blocs } = await ancienne.query(
        "SELECT title, repeat_unit, repeat_every FROM busy_blocks ORDER BY title",
      );
      expect(blocs).toEqual([
        { title: "Chimie", repeat_unit: null, repeat_every: 1 },
        { title: "Dentiste", repeat_unit: null, repeat_every: 1 },
      ]);
      const { rows: droits } = await ancienne.query<{ ok: boolean }>(
        "SELECT has_function_privilege('anon', 'public.group_busy_blocks(uuid)', 'EXECUTE') AS ok",
      );
      expect(droits).toEqual([{ ok: false }]);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Revue récurrence 1 : un bloc « tous les jours » compte pour 7 dans les 1000 blocs", () => {
  /** `n` blocs « tous les `every` jours » (ou hebdomadaires si `every` est nul) pour `uid`. */
  async function blocs(uid: string, n: number, every: number | null) {
    return as(uid, () =>
      rows(
        every === null
          ? `INSERT INTO busy_blocks (title, start_time, end_time, weekday, valid_from, valid_until)
             SELECT 'Cours', '10:00', '11:00', 1 + g % 7, '2026-08-25', '2026-12-20'
             FROM generate_series(1, $1::int) g`
          : `INSERT INTO busy_blocks (title, start_time, end_time, valid_from, repeat_unit, repeat_every)
             SELECT 'Job', '10:00', '11:00', '2026-08-25', 'day', $2::int
             FROM generate_series(1, $1::int) g`,
        every === null ? [n] : [n, every],
      ),
    );
  }

  it("avant : 1000 « tous les jours » donnaient 7000 blocs par semaine ; maintenant au plus 1000", async () => {
    // 142 blocs « tous les jours » = 994 ; il reste de la place pour 6 blocs hebdomadaires.
    await blocs(A, 142, 1);
    await blocs(A, 6, null);
    await expect(blocs(A, 1, null)).rejects.toThrow(/Trop de blocs dans l'horaire/);
    await expect(blocs(A, 1, 1)).rejects.toThrow(/Trop de blocs dans l'horaire/);
    // « Tous les 7 jours » ou plus compte pour 1, comme un bloc hebdomadaire.
    await as(A, () =>
      rows(
        "DELETE FROM busy_blocks WHERE ctid IN (SELECT ctid FROM busy_blocks WHERE repeat_unit = 'day' LIMIT 1)",
      ),
    );
    await blocs(A, 1, 7);
    await blocs(A, 6, null);
    await expect(blocs(A, 1, 30)).rejects.toThrow(/Trop de blocs dans l'horaire/);
    // Les autres ne sont pas touchés.
    await blocs(B, 3, 1);
  });

  it("changer un bloc en « tous les jours » compte aussi ; le reste des modifications marche", async () => {
    await blocs(A, 996, null);
    const [id] = await as(A, () =>
      rows<{ id: string }>("SELECT id FROM busy_blocks WHERE owner_id = $1 LIMIT 1", [A]),
    );
    await as(A, () =>
      rows(
        "UPDATE busy_blocks SET weekday = NULL, repeat_unit = 'day', repeat_every = 2 WHERE id = $1",
        [id.id],
      ),
    ); // 995 + 4 = 999
    await expect(
      as(A, () => rows("UPDATE busy_blocks SET repeat_every = 1 WHERE id = $1", [id.id])),
    ).rejects.toThrow(/Trop de blocs dans l'horaire/); // 995 + 7 = 1002
    // Changer le titre, les heures, ou espacer la répétition reste permis.
    await as(A, () =>
      rows(
        "UPDATE busy_blocks SET title = 'Job', start_time = '09:00', repeat_every = 3 WHERE id = $1",
        [id.id],
      ),
    );
  });
});

describe("Revue récurrence 2 : migration 0015 sur une vieille base avec un bloc d'avant la revue 8", () => {
  it("s'applique même si un vieux bloc hebdomadaire dure plus d'un an (contrainte NOT VALID)", async () => {
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
        "0009_segment12_meetup_invites",
        "0010_review_plan_privacy",
        "0011_segment13_study_planner",
        "0012_segment18_availability_slots",
        "0013_review_availability_limit",
        "0014_outlook_connector",
      ];
      for (const tag of tags.slice(0, 5)) await ancienne.exec(drizzleSql(tag));
      await ancienne.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ali@example.com')", [
        A,
      ]);
      // Écrit avant la migration 0005 (qui a ajouté la limite d'un an en NOT VALID).
      await ancienne.query(
        `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ($1, 'Vieux cours', '10:00', '12:00', 1, '2024-08-26', '2026-05-20')`,
        [A],
      );
      for (const tag of tags.slice(5)) await ancienne.exec(drizzleSql(tag));
      await ancienne.exec(readFileSync(join(ROOT, "supabase/migration-0015.sql"), "utf8"));
      const { rows: blocs } = await ancienne.query("SELECT title, repeat_every FROM busy_blocks");
      expect(blocs).toEqual([{ title: "Vieux cours", repeat_every: 1 }]);
      // La règle s'applique toujours aux nouveaux blocs.
      await expect(
        ancienne.query(
          `INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday, valid_from, valid_until)
           VALUES ($1, 'Trop long', '10:00', '12:00', 1, '2026-08-25', '2027-09-01')`,
          [A],
        ),
      ).rejects.toThrow(/busy_blocks_validity_span/);
    } finally {
      await ancienne.close();
    }
  }, 60_000);
});

describe("Calendriers abonnés (migration 0017) : privés, occupé au choix, retrait", () => {
  const F1 = "https://example.com/f1.ics";
  const EVENTS = JSON.stringify([
    { title: "GP du Mexique", start: "15:00", end: "17:00", weekday: null, from: "2026-11-08" },
    {
      title: "Essais libres",
      start: "12:30",
      end: "13:30",
      weekday: 5,
      from: "2026-11-06",
      until: "2026-11-20",
    },
  ]);

  async function subscribe(uid: string, busy: boolean, url = F1): Promise<string> {
    const [{ id }] = await as(uid, () =>
      rows<{ id: string }>(
        "INSERT INTO calendar_subscriptions (owner_id, kind, name, url, counts_as_busy) VALUES ($1, 'ics', 'F1', $2, $3) RETURNING id",
        [uid, url, busy],
      ),
    );
    return id;
  }

  const busyRows = (uid: string) =>
    as(uid, () =>
      rows<{ title: string; weekday: number | null }>(
        "SELECT title, weekday FROM busy_blocks WHERE source = 'subscription' ORDER BY valid_from",
      ),
    );

  it("l'abonnement et ses événements ne sont visibles que par la personne", async () => {
    const id = await subscribe(A, false);
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS]),
    );
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    expect(await as(A, () => rows("SELECT url FROM calendar_subscriptions"))).toEqual([
      { url: F1 },
    ]);
    expect(
      await as(A, () => rows("SELECT title FROM subscription_events ORDER BY valid_from")),
    ).toEqual([{ title: "Essais libres" }, { title: "GP du Mexique" }]);
    expect(await as(B, () => rows("SELECT * FROM calendar_subscriptions"))).toEqual([]);
    expect(await as(B, () => rows("SELECT * FROM subscription_events"))).toEqual([]);
    // B ne peut pas écrire les événements de A.
    await expect(
      as(B, () => rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS])),
    ).rejects.toThrow(/introuvable/);
    await expect(as(null, () => rows("SELECT * FROM calendar_subscriptions"))).rejects.toThrow();
  });

  it("ne compte pas comme occupé : aucun bloc ; occupé : blocs « Occupé » pour le groupe", async () => {
    const id = await subscribe(A, false);
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS]),
    );
    expect(await busyRows(A)).toEqual([]);
    await as(A, () => rows("SELECT public.set_subscription_busy($1, true)", [id]));
    expect(await busyRows(A)).toEqual([
      { title: "Essais libres", weekday: 5 },
      { title: "GP du Mexique", weekday: null },
    ]);
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);
    await as(A, () => rows("UPDATE profiles SET hide_block_titles = false WHERE id = $1", [A]));
    expect(
      await as(B, () =>
        rows(
          "SELECT DISTINCT title, title_hidden FROM public.group_busy_blocks($1) WHERE owner_id = $2",
          [g.id, A],
        ),
      ),
    ).toEqual([{ title: "Occupé", title_hidden: true }]);
    // Une nouvelle version remplace aussi les blocs.
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [
        id,
        JSON.stringify([
          { title: "GP du Brésil", start: "13:00", end: "15:00", from: "2026-11-15" },
        ]),
      ]),
    );
    expect(await busyRows(A)).toEqual([{ title: "GP du Brésil", weekday: null }]);
    await as(A, () => rows("SELECT public.set_subscription_busy($1, false)", [id]));
    expect(await busyRows(A)).toEqual([]);
    expect(await as(A, () => rows("SELECT title FROM subscription_events"))).toEqual([
      { title: "GP du Brésil" },
    ]);
  });

  it("personne ne modifie un abonnement ni ses blocs à la main", async () => {
    const id = await subscribe(A, true);
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS]),
    );
    await expect(
      as(A, () => rows("UPDATE calendar_subscriptions SET url = 'http://169.254.169.254/'")),
    ).rejects.toThrow();
    await expect(
      as(A, () => rows("UPDATE calendar_subscriptions SET last_attempt_at = NULL")),
    ).rejects.toThrow();
    await expect(
      as(A, () =>
        rows(
          "INSERT INTO subscription_events (subscription_id, owner_id, start_time, end_time, valid_from) VALUES ($1, $2, '08:00', '09:00', '2026-11-07')",
          [id, A],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      as(A, () =>
        rows(
          "INSERT INTO busy_blocks (title, start_time, end_time, valid_from, source) VALUES ('x', '08:00', '09:00', '2026-11-07', 'subscription')",
        ),
      ),
    ).rejects.toThrow();
    const maj = await as(
      A,
      async () =>
        (await db.query("UPDATE busy_blocks SET title = 'x' WHERE source = 'subscription'"))
          .affectedRows,
    );
    const del = await as(
      A,
      async () =>
        (await db.query("DELETE FROM busy_blocks WHERE source = 'subscription'")).affectedRows,
    );
    expect([maj, del]).toEqual([0, 0]);
    // L'adresse doit être en http(s) (la BD le vérifie aussi).
    await expect(subscribe(A, true, "file:///etc/passwd")).rejects.toThrow(
      /calendar_subscriptions_url_format/,
    );
  });

  it("retirer l'abonnement retire ses événements et ses blocs", async () => {
    const id = await subscribe(A, true);
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS]),
    );
    await as(A, () => rows("DELETE FROM calendar_subscriptions WHERE id = $1", [id]));
    expect(await busyRows(A)).toEqual([]);
    expect(await rows("SELECT * FROM subscription_events")).toEqual([]);
  });

  it("une version refusée garde la dernière version connue et note l'erreur", async () => {
    const id = await subscribe(A, true);
    await as(A, () =>
      rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, EVENTS]),
    );
    await expect(
      as(A, () =>
        rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [
          id,
          JSON.stringify([{ title: "x", start: "10:00", end: "09:00", from: "2026-11-10" }]),
        ]),
      ),
    ).rejects.toThrow();
    const trop = JSON.stringify(
      Array.from({ length: 301 }, () => ({ start: "10:00", end: "11:00", from: "2026-11-10" })),
    );
    await expect(
      as(A, () => rows("SELECT public.replace_subscription_events($1, $2::jsonb)", [id, trop])),
    ).rejects.toThrow(/300/);
    expect(await busyRows(A)).toHaveLength(2);
    await as(A, () => rows("SELECT public.fail_subscription_sync($1, 'Lien brisé.')", [id]));
    expect(
      await as(A, () =>
        rows(
          "SELECT last_sync_error, last_synced_at IS NOT NULL AS ok FROM calendar_subscriptions",
        ),
      ),
    ).toEqual([{ last_sync_error: "Lien brisé.", ok: true }]);
    expect(await busyRows(A)).toHaveLength(2);
  });

  it("claim_subscription_syncs réserve les abonnements dus, une fois", async () => {
    const id = await subscribe(A, false);
    const claim = (min: number, only: string | null = null) =>
      as(A, () =>
        rows<{ r: { id: string; kind: string; url: string }[] }>(
          "SELECT public.claim_subscription_syncs($1, $2) AS r",
          [min, only],
        ),
      );
    const [{ r }] = await claim(360);
    expect(r).toEqual([{ id, kind: "ics", url: F1, outlook_calendar_id: null }]);
    // Verrou posé (synchro en cours) : rien ; et B ne voit jamais les abonnements de A.
    expect((await claim(1))[0].r).toEqual([]);
    expect(await as(B, () => rows("SELECT public.claim_subscription_syncs(1, NULL) AS r"))).toEqual(
      [{ r: [] }],
    );
    // Fin de la synchro : trop tôt pour recommencer.
    await as(A, () => rows("SELECT public.replace_subscription_events($1, '[]'::jsonb)", [id]));
    expect((await claim(360, id))[0].r).toEqual([]);
  });

  it("au plus 10 abonnements ; déconnecter Outlook retire ceux lus par Outlook", async () => {
    for (let i = 0; i < 10; i++) await subscribe(A, false, `https://example.com/${i}.ics`);
    await expect(subscribe(A, false, "https://example.com/11.ics")).rejects.toThrow(
      /10 au maximum/,
    );
    await as(A, () => rows("DELETE FROM calendar_subscriptions"));
    await as(A, () =>
      rows("INSERT INTO outlook_connections (owner_id, refresh_token_enc) VALUES ($1, 'v1.x')", [
        A,
      ]),
    );
    await as(A, () =>
      rows(
        "INSERT INTO calendar_subscriptions (owner_id, kind, name, outlook_calendar_id, counts_as_busy) VALUES ($1, 'outlook', 'Fériés', 'AAA', true)",
        [A],
      ),
    );
    await subscribe(A, false);
    await as(A, () => rows("SELECT public.disconnect_outlook()"));
    expect(await as(A, () => rows("SELECT kind FROM calendar_subscriptions"))).toEqual([
      { kind: "ics" },
    ]);
  });
});

describe("noms d'utilisateur (migration 0020)", () => {
  const D = "00000000-0000-4000-8000-00000000000d";
  const E = "00000000-0000-4000-8000-00000000000e";

  async function signUp(id: string, email: string, meta: Record<string, string>) {
    await db.query("INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)", [
      id,
      email,
      JSON.stringify(meta),
    ]);
  }

  async function profile(id: string) {
    const [p] = await rows<{ username: string | null; display_name: string }>(
      "SELECT username, display_name FROM profiles WHERE id = $1",
      [id],
    );
    return p;
  }

  it("copie le nom choisi (en minuscules) dans le profil et s'en sert comme nom affiché", async () => {
    await signUp(D, "d@example.com", { username: "  Ali.K " });
    expect(await profile(D)).toEqual({ username: "ali.k", display_name: "ali.k" });
  });

  it("compte sans nom (Google, anciens comptes) : username vide", async () => {
    expect(await profile(A)).toEqual({ username: null, display_name: "Ali" });
    await signUp(D, "d@example.com", { username: "x" });
    expect(await profile(D)).toEqual({ username: null, display_name: "d" });
  });

  it("un nom déjà pris fait échouer l'inscription", async () => {
    await signUp(D, "d@example.com", { username: "ali" });
    await expect(signUp(E, "e@example.com", { username: "ALI" })).rejects.toThrow();
    expect(await rows("SELECT id FROM auth.users WHERE id = $1", [E])).toEqual([]);
  });

  it("je peux changer mon nom, mais pas pour un nom pris ou mal formé", async () => {
    await signUp(D, "d@example.com", { username: "ali" });
    await as(B, () => rows("UPDATE profiles SET username = 'sam' WHERE id = $1", [B]));
    expect((await profile(B)).username).toBe("sam");
    await expect(
      as(B, () => rows("UPDATE profiles SET username = 'ali' WHERE id = $1", [B])),
    ).rejects.toThrow();
    await expect(
      as(B, () => rows("UPDATE profiles SET username = 'Sam!' WHERE id = $1", [B])),
    ).rejects.toThrow();
  });
});

describe("cours annulé cette fois-ci (migration 0021)", () => {
  async function weekly(uid: string): Promise<string> {
    const [{ id }] = await as(uid, () =>
      rows<{ id: string }>(
        "INSERT INTO busy_blocks (owner_id, title, start_time, end_time, weekday, valid_from, valid_until) VALUES ($1, 'Maths', '10:00', '12:00', 4, '2026-08-24', '2026-12-18') RETURNING id",
        [uid],
      ),
    );
    return id;
  }

  it("j'annule une occurrence de mon cours ; mon groupe la voit par group_busy_blocks", async () => {
    const id = await weekly(A);
    const g = await createGroup(A, "Amis");
    await join_(B, g.code);
    await as(A, () =>
      rows("UPDATE busy_blocks SET skip_days = '{2026-11-12}' WHERE id = $1", [id]),
    );
    const seen = await as(B, () =>
      rows<{ id: string; skip_days: string[] }>(
        "SELECT id, skip_days::text[] AS skip_days FROM public.group_busy_blocks($1) WHERE id = $2",
        [g.id, id],
      ),
    );
    expect(seen).toEqual([{ id, skip_days: ["2026-11-12"] }]);
  });

  it("personne d'autre ne peut annuler mon cours", async () => {
    const id = await weekly(A);
    const g = await createGroup(A, "Amis");
    await join_(B, g.code);
    await as(B, () =>
      rows("UPDATE busy_blocks SET skip_days = '{2026-11-12}' WHERE id = $1", [id]),
    );
    const [b] = await rows<{ n: number }>(
      "SELECT cardinality(skip_days) AS n FROM busy_blocks WHERE id = $1",
      [id],
    );
    expect(b.n).toBe(0);
  });

  it("refuse sur un bloc ponctuel et au-delà de 60 jours", async () => {
    const id = await weekly(A);
    const many = Array.from(
      { length: 61 },
      (_, i) => `2027-01-${String((i % 28) + 1).padStart(2, "0")}`,
    );
    await expect(
      as(A, () =>
        rows("UPDATE busy_blocks SET skip_days = $2::date[] WHERE id = $1", [
          id,
          `{${many.join(",")}}`,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      as(A, () =>
        rows(
          "INSERT INTO busy_blocks (owner_id, title, start_time, end_time, valid_from) VALUES ($1, 'RDV', '10:00', '11:00', '2026-11-12')",
          [A],
        ).then(() => rows("UPDATE busy_blocks SET skip_days = '{2026-11-12}' WHERE title = 'RDV'")),
      ),
    ).rejects.toThrow();
  });
});
