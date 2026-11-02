/**
 * Segment 11 : « Quand on peut se voir » de bout en bout sur PGlite. Les horaires des fixtures
 * du segment 4 sont écrits dans la base (au nom de chaque personne), puis relus par le même
 * magasin que l'app (mêmes requêtes que supabase-js, au nom de la personne connectée : RLS,
 * horaire des autres seulement par group_busy_blocks), convertis et passés à findMeetups.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_PROPOSALS_PER_DAY,
  type MeetupSearchInput,
  type MeetupSearchView,
  type MeetupStore,
  searchGroupMeetups,
  validateMeetupSearch,
} from "@/lib/meetups/search";
import { findMeetups } from "@/lib/scheduling/findMeetups";
import { ceilToMinutes } from "@/lib/scheduling/period";
import { TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import type { MeetupProposal, Person } from "@/lib/scheduling/types";
import { weekdayOf } from "@/lib/scheduling/weeklyBlocks";

import {
  PLACES,
  PLACES_BY_ID,
  ali,
  at,
  block,
  leo,
  maya,
  sam,
} from "../../scheduling/__tests__/fixtures";
import type { BusyBlockInput, PlaceInput, ProfileInput } from "../convert";
import { FAKE_SUPABASE, asUser } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALI = uuid(1);
const SAM = uuid(2);
const MAYA = uuid(3);
const LEO = uuid(4);
const NOA = uuid(5);
const ZOE = uuid(6); // n'est pas membre du groupe

let db: PGlite;
const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);
async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Lundi 15 septembre 2025, 7 h (heure de Montréal) : « cette semaine » = 15 au 21. */
const NOW = zonedTime("2025-09-15", "07:00");
const travel = () => new EstimatedTravelProvider();

/**
 * Magasin de « Quand on peut se voir » sur PGlite : mêmes lectures que
 * src/app/groupes/meetup-actions.ts, au nom de `uid` (rôle authenticated, donc RLS).
 */
function pgliteMeetupStore(uid: string): MeetupStore {
  const read = async <T>(sql: string, params: unknown[]) => {
    try {
      return { ok: true as const, value: await as(uid, () => rows<T>(sql, params)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  };
  return {
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
                unavailable_after::text
         FROM profiles WHERE id = ANY($1::uuid[])`,
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
                valid_from::text, valid_until::text
         FROM public.group_busy_blocks($1)`,
        [gid],
      ),
  };
}

/** Écrit une personne des fixtures dans la base, en son nom (lieux, profil, blocs hebdo). */
async function seedPerson(uid: string, person: Person): Promise<Map<string, string>> {
  return as(uid, async () => {
    const ids = new Map<string, string>();
    for (const p of person.places) {
      const [r] = await rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng) VALUES ($1, $2, $3) RETURNING id",
        [p.name, p.lat, p.lng],
      );
      ids.set(p.id, r.id);
    }
    await rows(
      "UPDATE profiles SET display_name = $2, travel_mode = $3, home_place_id = $4 WHERE id = $1",
      [uid, person.name, person.travelMode, ids.get(person.homePlaceId)],
    );
    for (const b of person.busyBlocks) {
      const day = formatInTimeZone(b.start, TIME_ZONE, "yyyy-MM-dd");
      await rows(
        `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, '2025-08-25', '2025-12-19')`,
        [
          b.title,
          ids.get(b.placeId),
          formatInTimeZone(b.start, TIME_ZONE, "HH:mm"),
          formatInTimeZone(b.end, TIME_ZONE, "HH:mm"),
          weekdayOf(day),
        ],
      );
    }
    return ids;
  });
}

async function createGroupWith(owner: string, others: string[]): Promise<string> {
  const gid = await as(owner, async () => {
    const [{ id }] = await rows<{ id: string }>("SELECT public.create_group('Les amis') AS id");
    return id;
  });
  const [{ invite_code }] = await as(owner, () =>
    rows<{ invite_code: string }>("SELECT invite_code FROM groups WHERE id = $1", [gid]),
  );
  for (const uid of others) {
    await as(uid, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
  }
  return gid;
}

function input(gid: string, ids: string[], extra: Partial<MeetupSearchInput> = {}) {
  return {
    groupId: gid,
    participantIds: ids,
    period: "this-week" as const,
    durationMinutes: 30 as const,
    bufferMinutes: 5,
    ...extra,
  };
}

async function search(
  uid: string,
  req: MeetupSearchInput,
  dayHours?: { start: string; end: string },
): Promise<MeetupSearchView> {
  const r = await searchGroupMeetups(pgliteMeetupStore(uid), req, {
    userId: uid,
    now: NOW,
    travel: travel(),
    dayHours,
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Forme comparable d'une proposition : lieu par son nom, trajets par prénom. */
type Norm = { kind: string; place: string | null; start: string; end: string; travel: string };
function normFromFixture(p: MeetupProposal, people: Person[]): Norm {
  return {
    kind: p.kind,
    place: p.placeId ? (PLACES_BY_ID[p.placeId]?.name ?? p.placeId) : null,
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    travel: people
      .map((x) => `${x.name}:${p.travelByPerson[x.id]?.to}/${p.travelByPerson[x.id]?.from}`)
      .join(","),
  };
}
function normFromView(v: MeetupSearchView): Norm[] {
  // findMeetups classe tout ensemble ; la vue sépare en personne et appels : on regarde
  // l'ensemble trié chronologiquement.
  return [...v.inPerson, ...v.calls].map((p) => ({
    kind: p.kind,
    place: p.placeName,
    start: p.start,
    end: p.end,
    travel: p.travel.map((t) => `${t.name}:${t.to}/${t.from}`).join(","),
  }));
}
const byTime = (a: Norm, b: Norm) =>
  a.start.localeCompare(b.start) || (a.place ?? "").localeCompare(b.place ?? "");

/** L'ami du cas « ali » : à l'UdeM le lundi avant et après la pause d'ali (comme au segment 4). */
const ami: Person = {
  id: "ami",
  name: "Ami",
  homePlaceId: PLACES.mayaHome.id,
  travelMode: "transit",
  places: [PLACES.mayaHome, PLACES.udem],
  busyBlocks: [
    block("ami-1", "lun", "08:00", "09:30", PLACES.udem.id, "Cours"),
    block("ami-2", "lun", "11:30", "13:00", PLACES.udem.id, "Cours"),
  ],
};

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
  for (const [id, mail] of [
    [ALI, "ali"],
    [SAM, "sam"],
    [MAYA, "maya"],
    [LEO, "leo"],
    [NOA, "noa"],
    [ZOE, "zoe"],
  ]) {
    await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${mail}@example.com`,
    ]);
  }
});

describe("Quand on peut se voir : cas « ali » de bout en bout (BD → propositions)", () => {
  it("pause de 1 h au cégep, ami à 40 min : rien chez l'ami, un appel pendant la pause", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, ami);
    const gid = await createGroupWith(ALI, [SAM]);
    const morning = { start: "08:00", end: "13:00" };

    const v = await search(SAM, input(gid, [ALI, SAM]), morning);
    expect(v.participants.map((p) => p.name)).toEqual(["ali", "Ami"]);
    // Lundi matin : aucune rencontre en personne (ni à l'UdeM, ni ailleurs).
    const lundi = (p: { start: string }) => p.start.startsWith("2025-09-15");
    expect(v.inPerson.filter(lundi)).toEqual([]);
    expect(v.inPerson.some((p) => p.placeName === PLACES.udem.name && lundi(p))).toBe(false);
    // Mais un appel pendant la pause d'ali (10 h → 11 h).
    expect(v.calls.filter(lundi)).toMatchObject([
      {
        kind: "call",
        start: at("lun", "10:00").toISOString(),
        end: at("lun", "11:00").toISOString(),
        dayLabel: "lundi 15 septembre",
        timeLabel: "10 h – 11 h",
        durationMinutes: 60,
      },
    ]);

    // Ce que prédit findMeetups sur les fixtures (segments 4 et 5), même semaine.
    const predicted = await findMeetups(
      [ali, ami],
      {
        personIds: ["ali", "ami"],
        dates: { from: "2025-09-15", to: "2025-09-21" },
        minDurationMinutes: 30,
        bufferMinutes: 5,
        dayHours: morning,
        notBefore: ceilToMinutes(NOW),
      },
      travel(),
      { maxPerDay: MAX_PROPOSALS_PER_DAY },
    );
    expect(normFromView(v).sort(byTime)).toEqual(
      predicted.map((p) => normFromFixture(p, [ali, ami])).sort(byTime),
    );

    // Journée entière : toujours rien à l'UdeM pendant la pause.
    const full = await search(ALI, input(gid, [ALI, SAM]));
    const pause = [at("lun", "10:00").getTime(), at("lun", "11:00").getTime()];
    const pendantLaPause = full.inPerson.filter(
      (p) => Date.parse(p.start) < pause[1] && Date.parse(p.end) > pause[0],
    );
    expect(pendantLaPause).toEqual([]);
  });
});

describe("Quand on peut se voir : fixtures du segment 4 lues depuis la BD", () => {
  it("ali, Sam, Maya et Léo sur la semaine : mêmes propositions que findMeetups sur les fixtures", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    await seedPerson(MAYA, maya);
    await seedPerson(LEO, leo);
    const gid = await createGroupWith(ALI, [SAM, MAYA, LEO]);

    for (const [ids, people] of [
      [
        [ALI, SAM],
        [ali, sam],
      ],
      [
        [ALI, SAM, MAYA],
        [ali, sam, maya],
      ],
      [
        [ALI, SAM, MAYA, LEO],
        [ali, sam, maya, leo],
      ],
    ] as const) {
      for (const durationMinutes of [30, 60, 120] as const) {
        const v = await search(MAYA, input(gid, [...ids], { durationMinutes }));
        const predicted = await findMeetups(
          [...people],
          {
            personIds: people.map((p) => p.id),
            dates: { from: "2025-09-15", to: "2025-09-21" },
            minDurationMinutes: durationMinutes,
            bufferMinutes: 5,
            notBefore: ceilToMinutes(NOW),
          },
          travel(),
          { maxPerDay: MAX_PROPOSALS_PER_DAY },
        );
        expect(normFromView(v).sort(byTime)).toEqual(
          predicted.map((p) => normFromFixture(p, [...people])).sort(byTime),
        );
      }
    }
  });

  it("deux amis au même cégep, pause commune de 30 min mardi : proposé au cégep, sans trajet", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    const gid = await createGroupWith(SAM, [ALI]);
    const v = await search(ALI, input(gid, [ALI, SAM]));
    const midi = v.inPerson.find((p) => p.start === at("mar", "12:00").toISOString());
    expect(midi).toMatchObject({
      placeName: PLACES.cegepEM.name,
      end: at("mar", "12:30").toISOString(),
      timeLabel: "12 h – 12 h 30",
      travel: [
        { name: "ali", to: 0, from: 0 },
        { name: "Sam", to: 0, from: 0 },
      ],
    });
  });

  it("lieux favoris du groupe proposés ; heures « je ne sors pas » respectées", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    const gid = await createGroupWith(ALI, [SAM]);
    await as(SAM, () =>
      rows(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ($1, $2, $3, $4, true)",
        [PLACES.cafeLongueuil.name, PLACES.cafeLongueuil.lat, PLACES.cafeLongueuil.lng, gid],
      ),
    );
    const avant = await search(ALI, input(gid, [ALI, SAM], { durationMinutes: 60 }));
    expect(avant.inPerson.some((p) => p.placeName === PLACES.cafeLongueuil.name)).toBe(true);
    expect(avant.inPerson.some((p) => clockOf(p.end) > "20:00")).toBe(true);

    // Sam ne sort pas après 20 h : plus rien qui finit après 20 h moins son retour.
    await as(SAM, () =>
      rows("UPDATE profiles SET unavailable_after = '20:00' WHERE id = $1", [SAM]),
    );
    const apres = await search(ALI, input(gid, [ALI, SAM], { durationMinutes: 60 }));
    for (const p of apres.inPerson) {
      const sam_ = p.travel.find((t) => t.name === "Sam")!;
      const retour = Date.parse(p.end) + (sam_.from > 0 ? sam_.from + 5 : 0) * 60_000;
      expect(clockOf(new Date(retour).toISOString()) <= "20:00").toBe(true);
    }
  });
});

const clockOf = (iso: string) => formatInTimeZone(new Date(iso), TIME_ZONE, "HH:mm");

describe("Quand on peut se voir : sécurité et confidentialité", () => {
  it("un non-membre ne peut pas lancer le calcul pour un groupe", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    const gid = await createGroupWith(ALI, [SAM]);
    const r = await searchGroupMeetups(pgliteMeetupStore(ZOE), input(gid, [ALI, SAM]), {
      userId: ZOE,
      now: NOW,
      travel: travel(),
    });
    expect(r).toEqual({ ok: false, error: "Groupe introuvable." });
    // Même en se glissant parmi les participants.
    const r2 = await searchGroupMeetups(pgliteMeetupStore(ZOE), input(gid, [ALI, ZOE]), {
      userId: ZOE,
      now: NOW,
      travel: travel(),
    });
    expect(r2.ok).toBe(false);
    // Et la base ne lui renvoie rien de toute façon.
    expect(await as(ZOE, () => rows("SELECT * FROM public.group_busy_blocks($1)", [gid]))).toEqual(
      [],
    );
  });

  it("un membre ne peut pas ajouter un non-membre aux participants", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    await seedPerson(ZOE, maya);
    const gid = await createGroupWith(ALI, [SAM]);
    const r = await searchGroupMeetups(pgliteMeetupStore(ALI), input(gid, [ALI, ZOE]), {
      userId: ALI,
      now: NOW,
      travel: travel(),
    });
    expect(r).toEqual({ ok: false, error: "Un des participants ne fait pas partie du groupe." });
  });

  it("lieu non visible (favori d'un autre groupe) : bloc gardé comme occupé, à la maison, jamais proposé", async () => {
    await seedPerson(ALI, ali);
    const samIds = await seedPerson(SAM, sam);
    const gid = await createGroupWith(ALI, [SAM]);
    // Sam et Zoé ont un autre groupe, avec un lieu favori qu'ali ne voit pas.
    const autre = await createGroupWith(SAM, [ZOE]);
    const [{ id: secret }] = await as(SAM, () =>
      rows<{ id: string }>(
        "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ('Local secret', 45.56, -73.6, $1, true) RETURNING id",
        [autre],
      ),
    );
    // Sam y est le samedi de 13 h à 15 h.
    await as(SAM, () =>
      rows(
        `INSERT INTO busy_blocks (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
         VALUES ('Répétition', $1, '13:00', '15:00', 6, '2025-08-25', '2025-12-19')`,
        [secret],
      ),
    );
    expect(await as(ALI, () => rows("SELECT id FROM places WHERE id = $1", [secret]))).toEqual([]);

    const v = await search(ALI, input(gid, [ALI, SAM]));
    expect(v.hiddenPlaceBlocks).toEqual([{ name: "Sam", count: 1 }]);
    const names = new Set(v.inPerson.map((p) => p.placeName));
    expect(names.has("Local secret")).toBe(false);
    // Samedi de 13 h à 15 h, Sam est occupé : aucune proposition ne chevauche.
    const [a, b] = [at("sam", "13:00").getTime(), at("sam", "15:00").getTime()];
    expect(v.inPerson.filter((p) => Date.parse(p.start) < b && Date.parse(p.end) > a)).toEqual([]);
    // Le bloc est traité comme s'il était à la maison de Sam : proposé chez lui juste avant.
    expect(samIds.size).toBeGreaterThan(0);
  });

  it("participant sans maison : écarté du calcul avec la raison", async () => {
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    const gid = await createGroupWith(ALI, [SAM, NOA]);
    const v = await search(ALI, input(gid, [ALI, SAM, NOA]));
    expect(v.excluded).toEqual([
      { id: NOA, name: "noa", reason: "n'a pas encore choisi son lieu « maison »" },
    ]);
    expect(v.participants.map((p) => p.name)).toEqual(["ali", "Sam"]);
    expect(v.inPerson.length).toBeGreaterThan(0);
  });
});

describe("Quand on peut se voir : temps de calcul", () => {
  it("5 personnes sur une semaine : moins de 2 s (lecture BD comprise)", async () => {
    const noa: Person = {
      id: "noa",
      name: "Noa",
      homePlaceId: PLACES.downtown.id,
      travelMode: "bike",
      places: [PLACES.downtown, PLACES.udem, PLACES.parcJeanDrapeau, PLACES.cafeLongueuil],
      busyBlocks: [
        block("noa-1", "lun", "09:00", "12:00", PLACES.udem.id, "Cours"),
        block("noa-2", "mar", "13:00", "17:00", PLACES.downtown.id, "Travail"),
        block("noa-3", "jeu", "09:00", "11:00", PLACES.udem.id, "Cours"),
        block("noa-4", "ven", "14:00", "18:00", PLACES.downtown.id, "Travail"),
      ],
    };
    await seedPerson(ALI, ali);
    await seedPerson(SAM, sam);
    await seedPerson(MAYA, maya);
    await seedPerson(LEO, leo);
    await seedPerson(NOA, noa);
    const gid = await createGroupWith(ALI, [SAM, MAYA, LEO, NOA]);
    for (const p of [PLACES.cafeLongueuil, PLACES.parcJeanDrapeau]) {
      await as(ALI, () =>
        rows(
          "INSERT INTO places (name, lat, lng, group_id, is_group_favorite) VALUES ($1, $2, $3, $4, true)",
          [p.name, p.lat, p.lng, gid],
        ),
      );
    }
    const ids = [ALI, SAM, MAYA, LEO, NOA];
    const timings: { duration: number; totalMs: number; computeMs: number; n: number }[] = [];
    for (const durationMinutes of [30, 60, 120] as const) {
      const t0 = performance.now();
      const v = await search(ALI, input(gid, ids, { durationMinutes, period: "this-week" }));
      const totalMs = performance.now() - t0;
      timings.push({
        duration: durationMinutes,
        totalMs: Math.round(totalMs),
        computeMs: Math.round(v.computeMs * 10) / 10,
        n: v.inPerson.length + v.calls.length,
      });
      expect(v.participants).toHaveLength(5);
      expect(v.computeMs).toBeLessThan(2000);
      expect(totalMs).toBeLessThan(2000);
    }
    console.log("Temps « quand on peut se voir », 5 personnes, 1 semaine :", timings);
  });
});

describe("validateMeetupSearch", () => {
  const ok = {
    groupId: uuid(9),
    participantIds: [ALI, SAM],
    period: "next-week",
    durationMinutes: 45,
  };
  it("accepte une demande valide (marge par défaut 5 min, doublons retirés)", () => {
    expect(validateMeetupSearch({ ...ok, participantIds: [ALI, SAM, ALI.toUpperCase()] })).toEqual({
      ok: true,
      value: { ...ok, bufferMinutes: 5 },
    });
  });
  it("refuse durée, période, marge, participants ou groupe invalides", () => {
    const bad = (x: Record<string, unknown>) => validateMeetupSearch({ ...ok, ...x }).ok;
    expect(bad({ durationMinutes: 50 })).toBe(false);
    expect(bad({ durationMinutes: "60" })).toBe(false);
    expect(bad({ period: "demain" })).toBe(false);
    expect(bad({ bufferMinutes: -1 })).toBe(false);
    expect(bad({ bufferMinutes: 31 })).toBe(false);
    expect(bad({ bufferMinutes: 2.5 })).toBe(false);
    expect(bad({ bufferMinutes: 30 })).toBe(true);
    expect(bad({ participantIds: [ALI] })).toBe(false);
    expect(bad({ participantIds: [ALI, "pas-un-uuid"] })).toBe(false);
    expect(bad({ participantIds: Array.from({ length: 21 }, (_, i) => uuid(100 + i)) })).toBe(
      false,
    );
    expect(bad({ groupId: "x" })).toBe(false);
    expect(validateMeetupSearch(null).ok).toBe(false);
  });
});
