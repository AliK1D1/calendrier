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

const FAKE_SUPABASE = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
`;

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
    const [g] = await rows<{ id: string; invite_code: string }>(
      "INSERT INTO groups (name) VALUES ($1) RETURNING id, invite_code",
      [name],
    );
    return { id: g.id, code: g.invite_code };
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

  it("supabase/migration-0002.sql à migration-0005.sql sont à jour (npm run db:setup-sql)", () => {
    const separees = buildSeparateMigrations(ROOT);
    expect(Object.keys(separees)).toEqual([
      "supabase/migration-0002.sql",
      "supabase/migration-0003.sql",
      "supabase/migration-0004.sql",
      "supabase/migration-0005.sql",
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
      expect(policies[0].n).toBe(26);
    } finally {
      await vide.close();
    }
  }, 60_000);

  it("s'applique sur une base vide et crée les 7 tables avec RLS activé", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(tables.map((t) => t.relname)).toEqual([
      "busy_blocks",
      "group_members",
      "groups",
      "meetup_plans",
      "places",
      "plan_votes",
      "profiles",
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

    const seen = await as(A, () =>
      rows<{ title: string }>("SELECT title FROM busy_blocks ORDER BY title"),
    );
    expect(seen.map((r) => r.title)).toEqual(["Chimie", "Travail de Sam"]);

    // C n'est pas dans le groupe : il ne voit ni A ni B.
    const seenByC = await as(C, () => rows("SELECT * FROM busy_blocks"));
    expect(seenByC).toEqual([]);

    // B quitte le groupe : A ne voit plus son horaire.
    await as(B, () =>
      rows("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [g.id, B]),
    );
    const after = await as(A, () => rows<{ title: string }>("SELECT title FROM busy_blocks"));
    expect(after.map((r) => r.title)).toEqual(["Chimie"]);
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

    // A ne peut pas non plus se donner l'horaire (changer owner_id) de B.
    await expect(
      as(A, () => rows("UPDATE busy_blocks SET owner_id = $1 WHERE owner_id = $2", [B, A])),
    ).rejects.toThrow(/row-level security/);

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

  it("plans et votes : visibles par le groupe, chacun ne vote que pour soi", async () => {
    const lieuDeA = await seedSchedule(A, "Chimie");
    const g = await createGroup(A, "Le cégep");
    await join_(B, g.code);

    const [plan] = await as(A, () =>
      rows<{ id: string }>(
        `INSERT INTO meetup_plans (group_id, place_id, starts_at, ends_at)
         VALUES ($1, $2, '2025-09-15 16:00-04', '2025-09-15 17:00-04') RETURNING id`,
        [g.id, lieuDeA],
      ),
    );
    // C (hors groupe) ne peut pas proposer de plan dans ce groupe ni le voir.
    await expect(
      as(C, () =>
        rows(
          `INSERT INTO meetup_plans (group_id, starts_at, ends_at)
           VALUES ($1, '2025-09-15 16:00-04', '2025-09-15 17:00-04')`,
          [g.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await as(C, () => rows("SELECT * FROM meetup_plans"))).toEqual([]);

    await as(B, () => rows("INSERT INTO plan_votes (plan_id, vote) VALUES ($1, 'yes')", [plan.id]));
    await expect(
      as(B, () =>
        rows("INSERT INTO plan_votes (plan_id, user_id, vote) VALUES ($1, $2, 'no')", [plan.id, A]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(C, () => rows("INSERT INTO plan_votes (plan_id, vote) VALUES ($1, 'yes')", [plan.id])),
    ).rejects.toThrow(/row-level security/);

    const votes = await as(A, () =>
      rows<{ user_id: string; vote: string }>("SELECT user_id, vote FROM plan_votes"),
    );
    expect(votes).toEqual([{ user_id: B, vote: "yes" }]);

    // B ne peut pas confirmer le plan de A (seul le créateur le modifie).
    const parB = await as(
      B,
      async () => (await db.query("UPDATE meetup_plans SET status = 'confirmed'")).affectedRows,
    );
    expect(parB).toBe(0);
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
    const vus = await as(B, () =>
      rows<{ title: string }>("SELECT title FROM busy_blocks WHERE owner_id = $1 ORDER BY title", [
        A,
      ]),
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
