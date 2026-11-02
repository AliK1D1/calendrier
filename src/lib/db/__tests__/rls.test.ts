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
import { buildSetupSql } from "../../../../scripts/build-setup-sql.mjs";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

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
