/**
 * Le script de seed (`scripts/seed-test-data.mjs`) sur une vraie base Postgres en mémoire
 * (PGlite + supabase/setup.sql) : chaque compte écrit ses données avec SA session (RLS), par
 * les mêmes fonctions SQL que l'app. On relit ensuite la base et on vérifie que les scénarios
 * des jeux de données s'y retrouvent (docs/jeux-de-donnees.md).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accountOf,
  keyRole,
  runSeed,
  safetyProblems,
} from "../../../../scripts/seed-test-data.mjs";
import { findMeetups } from "@/lib/scheduling/findMeetups";
import { planConflicts } from "@/lib/scheduling/planConflicts";
import { TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import { PEOPLE, dayOf, nextMonday } from "@/lib/testdata/freecrew";
import { expandBusyBlocks, toPeople, type BusyBlockInput } from "../convert";
import { asUser, FAKE_SUPABASE } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

let db: PGlite;
let ids: Awaited<ReturnType<typeof runSeed>>;
/** Le seed vise le prochain lundi : propose_meetup refuse les moments passés. */
const MONDAY = nextMonday(formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd"));

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** Adaptateur PGlite : mêmes opérations que l'adaptateur Supabase, en tant que l'utilisateur. */
function pgliteAdapter() {
  const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
  return {
    async signUp({ email, username }: { email: string; username: string }) {
      const id = randomUUID();
      await db.query("INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)", [
        id,
        email,
        JSON.stringify({ username }),
      ]);
      return id;
    },
    completeOnboarding: (uid: string) =>
      as(uid, () => db.query("SELECT public.complete_onboarding()")),
    insert: (uid: string, table: string, row: Record<string, unknown>) =>
      as(uid, () => {
        const cols = Object.keys(row);
        return db.query(
          `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          Object.values(row),
        );
      }),
    update: (uid: string, table: string, id: string, values: Record<string, unknown>) =>
      as(uid, async () => {
        const cols = Object.keys(values);
        const r = await db.query(
          `UPDATE public.${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
          [id, ...Object.values(values)],
        );
        if (r.affectedRows !== 1) throw new Error(`Modification refusée : ${table} ${id}`);
      }),
    remove: (uid: string, table: string, id: string) =>
      as(uid, () => db.query(`DELETE FROM public.${table} WHERE id = $1`, [id])),
    createGroup: (uid: string, name: string) =>
      as(uid, async () => {
        const { id } = await one<{ id: string }>("SELECT public.create_group($1) AS id", [name]);
        const { invite_code } = await one<{ invite_code: string }>(
          "SELECT invite_code FROM public.groups WHERE id = $1",
          [id],
        );
        return { id, inviteCode: invite_code };
      }),
    joinGroup: (uid: string, code: string) =>
      as(uid, () => db.query("SELECT public.join_group_by_code($1)", [code])),
    proposePlan: (
      uid: string,
      p: {
        groupId: string;
        startsAt: string;
        endsAt: string;
        title: string;
        placeId: string | null;
        location: string;
      },
    ) =>
      as(uid, async () => {
        const { id } = await one<{ id: string }>(
          "SELECT public.propose_meetup($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, NULL) AS id",
          [p.groupId, p.startsAt, p.endsAt, p.title, p.placeId, p.location],
        );
        return id;
      }),
    respondPlan: (uid: string, planId: string, accept: boolean) =>
      as(uid, () => db.query("SELECT public.respond_to_meetup($1, $2)", [planId, accept])),
  };
}

/** Relit la base (sans RLS) sous la forme attendue par `toPeople`. */
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(FAKE_SUPABASE);
  await db.exec(SETUP_SQL);
  ids = await runSeed(pgliteAdapter(), { monday: MONDAY, password: "MotDePasse1" });
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("script de seed : garde-fous", () => {
  const ok = {
    url: "https://testref.supabase.co",
    key: "sb_publishable_abc",
    password: "MotDePasse1",
    confirmRef: "testref",
    appUrls: ["https://vraiebase.supabase.co"],
  };

  it("accepte une base de test confirmée, avec la clé anon", () => {
    expect(safetyProblems(ok)).toEqual([]);
  });

  it("refuse la base de l'app, une clé secrète, un mot de passe faible et l'oubli de confirmer", () => {
    expect(safetyProblems({ ...ok, appUrls: ["https://testref.supabase.co/"] })).toHaveLength(1);
    expect(safetyProblems({ ...ok, key: "sb_secret_abc" })).toHaveLength(1);
    expect(safetyProblems({ ...ok, password: "motdepasse" })).toHaveLength(1);
    expect(safetyProblems({ ...ok, confirmRef: undefined })).toHaveLength(1);
    expect(safetyProblems({ ...ok, url: undefined, key: undefined })).not.toEqual([]);
  });

  it("reconnaît le rôle d'une ancienne clé JWT", () => {
    const jwt = (role: string) =>
      `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
    expect(keyRole(jwt("service_role"))).toBe("service_role");
    expect(keyRole(jwt("anon"))).toBe("anon");
  });

  it("les comptes ont des noms d'utilisateur valides, même avec un --tag", () => {
    for (const p of PEOPLE) {
      expect(accountOf(p, { tag: "b2" }).username).toMatch(/^[a-z0-9][a-z0-9_.]{2,19}$/);
      expect(accountOf(p).email).toMatch(/@example\.com$/);
    }
  });
});

describe("script de seed : la base contient les scénarios", () => {
  it("crée 10 comptes, dont Zoé sans maison (S07)", async () => {
    const { profiles, places, blocks, availabilities } = await readBack();
    expect(profiles).toHaveLength(PEOPLE.length);
    const week = { from: MONDAY, to: dayOf(MONDAY, "dim") };
    const { people, incomplete } = toPeople(profiles, places, blocks, week, { availabilities });
    expect(incomplete.map((i) => i.id)).toEqual([ids.uid.zoe]);
    expect(people).toHaveLength(PEOPLE.length - 1);
  });

  it("S01 : ali et Sam se voient au cégep lundi de 11 h à 13 h, sans trajet", async () => {
    const { profiles, places, blocks, availabilities } = await readBack();
    const day = dayOf(MONDAY, "lun");
    const { people } = toPeople(
      profiles,
      places,
      blocks,
      { from: day, to: day },
      { availabilities },
    );
    const proposals = await findMeetups(
      people,
      {
        personIds: [ids.uid.ali, ids.uid.sam],
        dates: { from: day, to: day },
        minDurationMinutes: 60,
        bufferMinutes: 5,
      },
      new EstimatedTravelProvider(),
    );
    const hit = proposals.find(
      (p) =>
        p.start.getTime() === zonedTime(day, "11:00").getTime() &&
        p.end.getTime() === zonedTime(day, "13:00").getTime(),
    );
    expect(hit?.kind).toBe("in-person");
  });

  it("S12 : la marche acceptée par Jade bloque son dimanche (une sortie par jour)", async () => {
    const { profiles, places, blocks, availabilities } = await readBack();
    const day = dayOf(MONDAY, "dim");
    const { people } = toPeople(
      profiles,
      places,
      blocks,
      { from: day, to: day },
      { availabilities },
    );
    const proposals = await findMeetups(
      people,
      {
        personIds: [ids.uid.jade, ids.uid.nora],
        dates: { from: day, to: day },
        minDurationMinutes: 30,
        bufferMinutes: 5,
      },
      new EstimatedTravelProvider(),
    );
    expect(proposals).toEqual([]);
  });

  it("S14 et S16 : cours annulé enregistré, et dentiste sans lieu après la suppression", async () => {
    const { blocks } = await readBack();
    const drawing = blocks.find((b) => b.id === ids.blockId["lina.mer1"]);
    expect(drawing?.skip_days).toEqual([dayOf(MONDAY, "mer")]);
    const dentist = blocks.find((b) => b.id === ids.blockId["lina.dentiste"]);
    expect(dentist?.place_id).toBeNull();
    expect(dentist?.repeat_unit).toBe("month");
  });

  it("S19 : le souper accepté par Sam entre en conflit avec son quart de travail", async () => {
    const { blocks } = await readBack();
    const day = dayOf(MONDAY, "jeu");
    const slot = { start: zonedTime(day, "18:00"), end: zonedTime(day, "20:00") };
    const of = (uid: string) =>
      expandBusyBlocks(
        blocks.filter((b) => b.owner_id === uid),
        { from: day, to: day },
        "",
      );
    const meetupRows = blocks.filter((b) => b.source === "meetup" && b.title === "Souper au café");
    expect(meetupRows.map((b) => b.owner_id).sort()).toEqual([ids.uid.ali, ids.uid.sam].sort());
    const conflicts = planConflicts(
      slot,
      [ids.uid.ali, ids.uid.sam],
      new Map([
        [ids.uid.ali, of(ids.uid.ali)],
        [ids.uid.sam, of(ids.uid.sam)],
      ]),
    );
    expect(conflicts.map((c) => [c.personId, c.block.title])).toEqual([
      [ids.uid.sam, "Quart de travail"],
    ]);
  });

  it("le cinéma : Maya accepte, Léo refuse", async () => {
    const votes = (
      await db.query<{ user_id: string; vote: string }>(
        "SELECT user_id, vote::text FROM plan_votes WHERE plan_id = $1",
        [ids.planId.cinema],
      )
    ).rows;
    const byUser = new Map(votes.map((v) => [v.user_id, v.vote]));
    expect(byUser.get(ids.uid.maya)).toBe("yes");
    expect(byUser.get(ids.uid.leo)).toBe("no");
  });
});
