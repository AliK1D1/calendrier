/**
 * Le fichier SQL des jeux de données (supabase/seed-test-data.sql, à coller dans Supabase) sur
 * une base Postgres en mémoire (PGlite + supabase/setup.sql) : il crée les comptes et leurs
 * données, et les scénarios de docs/jeux-de-donnees.md s'y retrouvent. Le fichier d'effacement
 * enlève tout. On recrée en plus les colonnes de `auth.users`, la table `auth.identities` et
 * `extensions.crypt` de Supabase, dont le fichier a besoin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRemoveSql, buildSeedSql } from "../../../../scripts/build-seed-sql.mjs";
import { findMeetups } from "@/lib/scheduling/findMeetups";
import { planConflicts } from "@/lib/scheduling/planConflicts";
import { TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import { PEOPLE, dayOf, nextMonday } from "@/lib/testdata/freecrew";
import { expandBusyBlocks, toPeople, type BusyBlockInput } from "../convert";
import { FAKE_SUPABASE } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");
const SEED_FILE = readFileSync(join(ROOT, "supabase/seed-test-data.sql"), "utf8");
const REMOVE_FILE = readFileSync(join(ROOT, "supabase/seed-test-data-remove.sql"), "utf8");
const MONDAY = nextMonday(formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd"));

/** Ce que Supabase a en plus de notre faux schéma `auth`. */
const SUPABASE_AUTH_EXTRAS = `
  ALTER TABLE auth.users
    ADD COLUMN instance_id uuid, ADD COLUMN aud text, ADD COLUMN role text,
    ADD COLUMN encrypted_password text, ADD COLUMN email_confirmed_at timestamptz,
    ADD COLUMN raw_app_meta_data jsonb, ADD COLUMN created_at timestamptz,
    ADD COLUMN updated_at timestamptz, ADD COLUMN confirmation_token text,
    ADD COLUMN recovery_token text, ADD COLUMN email_change_token_new text,
    ADD COLUMN email_change text;
  CREATE TABLE auth.identities (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    provider_id text NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  CREATE SCHEMA extensions;
  CREATE FUNCTION extensions.gen_salt(text) RETURNS text LANGUAGE sql AS $$ SELECT 'sel' $$;
  CREATE FUNCTION extensions.crypt(text, text) RETURNS text LANGUAGE sql AS $$ SELECT md5($1 || $2) $$;
`;

const withPassword = (sql: string, password: string) =>
  sql.replace("'CHANGE-MOI'::text AS password", `'${password}'::text AS password`);

let db: PGlite;

async function uid(key: string): Promise<string> {
  const r = await db.query<{ id: string }>("SELECT id FROM auth.users WHERE email = $1", [
    `freecrew.${key}@example.com`,
  ]);
  return r.rows[0].id;
}

async function readBack() {
  const profiles = (
    await db.query<{
      id: string;
      display_name: string;
      travel_mode: "walk" | "bike" | "transit" | "car";
      home_place_id: string | null;
      unavailable_before: string | null;
      unavailable_after: string | null;
      max_outings_per_day: number | null;
      max_outings_per_week: number | null;
    }>(
      `SELECT id, display_name, travel_mode, home_place_id, unavailable_before::text,
              unavailable_after::text, max_outings_per_day, max_outings_per_week FROM profiles`,
    )
  ).rows;
  const places = (
    await db.query<{ id: string; owner_id: string; name: string; lat: number; lng: number }>(
      "SELECT id, owner_id, name, lat, lng FROM places",
    )
  ).rows;
  const blocks = (
    await db.query<BusyBlockInput>(
      `SELECT id, owner_id, title, place_id, start_time::text, end_time::text, weekday,
              valid_from::text, valid_until::text, repeat_unit, repeat_every, skip_days::text[],
              source FROM busy_blocks`,
    )
  ).rows;
  const availabilities = (
    await db.query<{
      id: string;
      owner_id: string;
      day: string;
      start_time: string;
      end_time: string;
    }>("SELECT id, owner_id, day::text, start_time::text, end_time::text FROM availability_slots")
  ).rows;
  return { profiles, places, blocks, availabilities };
}

async function meetups(keys: string[], dayKey: "lun" | "dim", min: number) {
  const { profiles, places, blocks, availabilities } = await readBack();
  const day = dayOf(MONDAY, dayKey);
  const range = { from: day, to: day };
  const { people } = toPeople(profiles, places, blocks, range, { availabilities });
  return findMeetups(
    people,
    {
      personIds: await Promise.all(keys.map(uid)),
      dates: range,
      minDurationMinutes: min,
      bufferMinutes: 5,
    },
    new EstimatedTravelProvider(),
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(FAKE_SUPABASE);
  await db.exec(SUPABASE_AUTH_EXTRAS);
  await db.exec(SETUP_SQL);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("fichiers SQL des jeux de données", () => {
  it("sont à jour (npm run db:seed-sql)", () => {
    expect(SEED_FILE).toBe(buildSeedSql());
    expect(REMOVE_FILE).toBe(buildRemoveSql());
  });

  it("refusent de tourner sans mot de passe choisi", async () => {
    await expect(db.exec(SEED_FILE)).rejects.toThrow("Remplace CHANGE-MOI");
    await db.exec("ROLLBACK");
    await expect(db.exec(withPassword(SEED_FILE, "faible"))).rejects.toThrow("Remplace CHANGE-MOI");
    await db.exec("ROLLBACK");
    expect((await db.query("SELECT 1 FROM auth.users")).rows).toEqual([]);
  });
});

describe("supabase/seed-test-data.sql", () => {
  beforeAll(async () => {
    await db.exec(withPassword(SEED_FILE, "Test1234"));
  }, 60_000);

  it("crée les 10 comptes avec leur nom d'utilisateur, déjà accueillis", async () => {
    const rows = (
      await db.query<{ username: string; onboarded: boolean }>(
        "SELECT username, onboarded_at IS NOT NULL AS onboarded FROM profiles ORDER BY username",
      )
    ).rows;
    expect(rows.map((r) => r.username)).toEqual(PEOPLE.map((p) => p.username).sort());
    expect(rows.every((r) => r.onboarded)).toBe(true);
    const identities = await db.query("SELECT 1 FROM auth.identities");
    expect(identities.rows).toHaveLength(PEOPLE.length);
  });

  it("S07 : Zoé est le seul profil sans maison", async () => {
    const { profiles, places, blocks, availabilities } = await readBack();
    const week = { from: MONDAY, to: dayOf(MONDAY, "dim") };
    const { incomplete } = toPeople(profiles, places, blocks, week, { availabilities });
    expect(incomplete.map((i) => i.id)).toEqual([await uid("zoe")]);
  });

  it("S01 : ali et Sam se voient au cégep lundi de 11 h à 13 h", async () => {
    const day = dayOf(MONDAY, "lun");
    const proposals = await meetups(["ali", "sam"], "lun", 60);
    const hit = proposals.find(
      (p) =>
        p.start.getTime() === zonedTime(day, "11:00").getTime() &&
        p.end.getTime() === zonedTime(day, "13:00").getTime(),
    );
    expect(hit?.kind).toBe("in-person");
  });

  it("S12 : la marche acceptée par Jade bloque son dimanche", async () => {
    expect(await meetups(["jade", "nora"], "dim", 30)).toEqual([]);
  });

  it("S14 et S16 : cours annulé et dentiste sans lieu", async () => {
    const lina = await uid("lina");
    const { blocks } = await readBack();
    const drawing = blocks.find((b) => b.owner_id === lina && b.title === "Cours de dessin");
    expect(drawing?.skip_days).toEqual([dayOf(MONDAY, "mer")]);
    const dentist = blocks.find((b) => b.owner_id === lina && b.title === "Dentiste");
    expect(dentist?.place_id).toBeNull();
    expect(dentist?.repeat_unit).toBe("month");
  });

  it("S19 : le souper accepté par Sam est en conflit avec son quart", async () => {
    const [ali, sam] = [await uid("ali"), await uid("sam")];
    const { blocks } = await readBack();
    const day = dayOf(MONDAY, "jeu");
    const of = (owner: string) =>
      expandBusyBlocks(
        blocks.filter((b) => b.owner_id === owner),
        { from: day, to: day },
        "",
      );
    const conflicts = planConflicts(
      { start: zonedTime(day, "18:00"), end: zonedTime(day, "20:00") },
      [ali, sam],
      new Map([
        [ali, of(ali)],
        [sam, of(sam)],
      ]),
    );
    expect(conflicts.map((c) => [c.personId, c.block.title])).toEqual([[sam, "Quart de travail"]]);
  });

  it("le cinéma : Maya accepte, Léo refuse", async () => {
    const votes = (
      await db.query<{ email: string; vote: string }>(
        `SELECT u.email, v.vote::text FROM plan_votes v
         JOIN meetup_plans p ON p.id = v.plan_id JOIN auth.users u ON u.id = v.user_id
         WHERE p.title = 'Cinéma'`,
      )
    ).rows;
    const byEmail = new Map(votes.map((v) => [v.email, v.vote]));
    expect(byEmail.get("freecrew.maya@example.com")).toBe("yes");
    expect(byEmail.get("freecrew.leo@example.com")).toBe("no");
  });

  it("refuse de tourner une deuxième fois", async () => {
    await expect(db.exec(withPassword(SEED_FILE, "Test1234"))).rejects.toThrow("existent déjà");
    await db.exec("ROLLBACK");
  });

  it("le fichier d'effacement enlève tout, et rien d'autre", async () => {
    await db.query(
      "INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-0000000000aa', 'ami@exemple.ca')",
    );
    await db.exec(REMOVE_FILE);
    const left = await db.query<{ email: string }>("SELECT email FROM auth.users");
    expect(left.rows.map((r) => r.email)).toEqual(["ami@exemple.ca"]);
    for (const table of ["places", "busy_blocks", "groups", "meetup_plans", "availability_slots"]) {
      const r = await db.query(`SELECT 1 FROM public.${table}`);
      expect(r.rows, table).toEqual([]);
    }
  });
});
