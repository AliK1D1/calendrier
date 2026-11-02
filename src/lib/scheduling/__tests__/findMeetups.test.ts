import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import {
  availabilityInWindow,
  findMeetupCandidates,
  intersectIntervals,
  memoizeTravel,
} from "../findMeetups";
import { EstimatedTravelProvider, estimateTravelMinutes } from "../travel";
import { TIME_ZONE, minutesBetween, zonedTime } from "../time";
import type { BusyBlock, MeetupRequest, Person, Place } from "../types";
import { FakeTravelProvider } from "./fakeTravel";
import { GROUP_FAVORITES, PEOPLE, PLACES, WEEK, ali, at, block, leo, maya, sam } from "./fixtures";

const estimated = () => new EstimatedTravelProvider();

function request(
  overrides: Partial<MeetupRequest> & Pick<MeetupRequest, "personIds">,
): MeetupRequest {
  return {
    dates: { from: WEEK.lun, to: WEEK.lun },
    minDurationMinutes: 30,
    bufferMinutes: 5,
    ...overrides,
  };
}

/** Vrai si [start, end] chevauche [a, b]. */
function overlaps(p: { start: Date; end: Date }, a: Date, b: Date): boolean {
  return p.start.getTime() < b.getTime() && p.end.getTime() > a.getTime();
}

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

describe("availabilityInWindow", () => {
  const D = "2025-09-16";
  const window = {
    start: zonedTime(D, "10:00"),
    end: zonedTime(D, "12:00"),
    placeBeforeId: "a",
    placeAfterId: "b",
  };

  it("arrivée = fin + trajet + marge ; départ = début suivant − trajet − marge", () => {
    expect(availabilityInWindow(window, { to: 15, from: 20 }, 5)).toEqual({
      start: zonedTime(D, "10:20"),
      end: zonedTime(D, "11:35"),
    });
  });

  it("pas de trajet (déjà sur place) : pas de marge", () => {
    expect(availabilityInWindow(window, { to: 0, from: 0 }, 5)).toEqual({
      start: window.start,
      end: window.end,
    });
  });

  it("arrivée ≥ départ : indisponible", () => {
    expect(availabilityInWindow(window, { to: 55, from: 55 }, 5)).toBeNull();
    expect(availabilityInWindow(window, { to: 60, from: 61 }, 0)).toBeNull();
  });
});

describe("intersectIntervals", () => {
  const D = "2025-09-16";
  const iv = (s: string, e: string, who: string) => ({
    start: zonedTime(D, s),
    end: zonedTime(D, e),
    legs: { [who]: { to: 1, from: 2 } },
  });

  it("intersection de deux listes, trajets fusionnés", () => {
    const out = intersectIntervals(
      [iv("08:00", "10:00", "a"), iv("12:00", "15:00", "a")],
      [iv("09:00", "13:00", "b"), iv("14:00", "16:00", "b")],
    );
    expect(out.map((o) => [o.start, o.end])).toEqual([
      [zonedTime(D, "09:00"), zonedTime(D, "10:00")],
      [zonedTime(D, "12:00"), zonedTime(D, "13:00")],
      [zonedTime(D, "14:00"), zonedTime(D, "15:00")],
    ]);
    expect(Object.keys(out[0].legs).sort()).toEqual(["a", "b"]);
  });

  it("intervalles qui se touchent seulement : pas d'intersection", () => {
    expect(intersectIntervals([iv("08:00", "10:00", "a")], [iv("10:00", "11:00", "b")])).toEqual(
      [],
    );
  });
});

describe("memoizeTravel", () => {
  it("n'appelle le fournisseur qu'une fois par paire et mode", async () => {
    const fake = new FakeTravelProvider([], 12);
    const memo = memoizeTravel(fake);
    await memo.minutes(PLACES.udem, PLACES.cegepEM, "walk");
    await memo.minutes(PLACES.udem, PLACES.cegepEM, "walk");
    await memo.minutes(PLACES.udem, PLACES.cegepEM, "car");
    expect(fake.calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cas du plan (section 3 et segment 4)
// ---------------------------------------------------------------------------

describe("findMeetupCandidates : critères du segment 4", () => {
  it("cas « ali » : pause de 1 h au cégep, ami à ~40 min → aucune proposition chez l'ami", async () => {
    // L'ami est à l'UdeM avant et après la pause d'ali (10 h → 11 h).
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
    // Le trajet cégep ↔ UdeM est bien d'environ 40 min ou plus.
    expect(estimateTravelMinutes(PLACES.cegepEM, PLACES.udem, "transit")).toBeGreaterThanOrEqual(
      40,
    );

    // Restreint à la matinée : la seule fenêtre d'ali est la pause de 10 h à 11 h.
    const morning = await findMeetupCandidates(
      [ali, ami],
      request({ personIds: ["ali", "ami"], dayHours: { start: "08:00", end: "13:00" } }),
      estimated(),
    );
    expect(morning.filter((p) => p.placeId === PLACES.udem.id)).toEqual([]);
    expect(morning).toEqual([]);

    // Sur toute la journée : rien chez l'ami pendant la pause.
    const allDay = await findMeetupCandidates(
      [ali, ami],
      request({ personIds: ["ali", "ami"] }),
      estimated(),
    );
    const duringBreak = allDay.filter((p) => overlaps(p, at("lun", "10:00"), at("lun", "11:00")));
    expect(duringBreak).toEqual([]);
  });

  it("même cas avec un faux trajet de 40 min exactement : aucune proposition chez l'ami", async () => {
    const ami: Person = {
      id: "ami",
      name: "Ami",
      homePlaceId: "ami-maison",
      travelMode: "transit",
      places: [{ id: "ami-maison", name: "Chez l'ami", lat: 45.52, lng: -73.6 }],
      busyBlocks: [],
    };
    const fake = new FakeTravelProvider([[PLACES.cegepEM.id, "ami-maison", 40]], 40);
    const out = await findMeetupCandidates(
      [ali, ami],
      request({
        personIds: ["ali", "ami"],
        dayHours: { start: "08:00", end: "13:00" },
        minDurationMinutes: 1,
        bufferMinutes: 0,
      }),
      fake,
    );
    // 10:00 + 40 = 10:40 ; 11:00 − 40 = 10:20 → arrivée après le départ.
    expect(out.filter((p) => p.placeId === "ami-maison")).toEqual([]);
    // Au cégep, c'est l'ami qui se déplace : 10:00 → 11:00, l'ami peut y être.
    expect(out.filter((p) => p.placeId === PLACES.cegepEM.id)).toHaveLength(1);
  });

  it("deux amis au même cégep, pause commune de 30 min, minimum 20 min → proposé au cégep", async () => {
    // Fixtures : mardi, ali et Sam sont au cégep jusqu'à 12 h et reprennent à 12 h 30.
    const out = await findMeetupCandidates(
      [ali, sam],
      request({
        personIds: ["ali", "sam"],
        dates: { from: WEEK.mar, to: WEEK.mar },
        minDurationMinutes: 20,
      }),
      estimated(),
    );
    const atCegep = out.filter(
      (p) => p.placeId === PLACES.cegepEM.id && overlaps(p, at("mar", "12:00"), at("mar", "12:30")),
    );
    expect(atCegep).toHaveLength(1);
    expect(atCegep[0]).toMatchObject({
      start: at("mar", "12:00"),
      end: at("mar", "12:30"),
      travelByPerson: { ali: { to: 0, from: 0 }, sam: { to: 0, from: 0 } },
    });
    // Aucun autre lieu n'est faisable pendant cette pause.
    const ailleurs = out.filter(
      (p) => p.placeId !== PLACES.cegepEM.id && overlaps(p, at("mar", "12:00"), at("mar", "12:30")),
    );
    expect(ailleurs).toEqual([]);
  });

  it("fin de journée, chacun rentre chez soi → propositions près de chez l'un d'eux", async () => {
    // Lundi : Sam finit à 15 h, ali à 16 h, tous deux au cégep ; ensuite, retour à la maison.
    const out = await findMeetupCandidates(
      [ali, sam],
      request({ personIds: ["ali", "sam"], minDurationMinutes: 60 }),
      estimated(),
    );
    const evening = out.filter((p) => p.start.getTime() >= at("lun", "16:00").getTime());
    const places = new Set(evening.map((p) => p.placeId));
    expect(places.has(PLACES.aliHome.id)).toBe(true);
    expect(places.has(PLACES.samHome.id)).toBe(true);

    const chezAli = evening.find((p) => p.placeId === PLACES.aliHome.id);
    expect(chezAli).toBeDefined();
    // ali rentre chez lui : trajet de retour nul ; il part du cégep (lieu du dernier cours).
    expect(chezAli!.travelByPerson.ali).toEqual({
      to: estimateTravelMinutes(PLACES.cegepEM, PLACES.aliHome, "transit"),
      from: 0,
    });
    // Sam doit rentrer à Saint-Lambert à vélo après la rencontre.
    expect(chezAli!.travelByPerson.sam.from).toBe(
      estimateTravelMinutes(PLACES.aliHome, PLACES.samHome, "bike"),
    );
    // La rencontre se termine juste à temps pour que Sam rentre avant 22 h (marge comprise).
    const samBack = chezAli!.end.getTime() + (chezAli!.travelByPerson.sam.from + 5) * 60_000;
    expect(samBack).toBeLessThanOrEqual(at("lun", "22:00").getTime());
  });

  it("groupe de 3 avec intersection trop courte → aucune proposition", async () => {
    const lieu: Place = { id: "lieu", name: "Lieu commun", lat: 45.5, lng: -73.6 };
    const mk = (id: string, free: [string, string]): Person => ({
      id,
      name: id,
      homePlaceId: "lieu",
      travelMode: "walk",
      places: [lieu],
      busyBlocks: [
        block(`${id}-am`, "mer", "08:00", free[0], "lieu", "Occupé"),
        block(`${id}-pm`, "mer", free[1], "22:00", "lieu", "Occupé"),
      ],
    });
    const group = [
      mk("a", ["12:00", "14:00"]),
      mk("b", ["12:30", "14:30"]),
      mk("c", ["13:45", "16:00"]),
    ];
    const req = request({
      personIds: ["a", "b", "c"],
      dates: { from: WEEK.mer, to: WEEK.mer },
      minDurationMinutes: 30,
    });
    // Deux à deux, ça marche ; à trois, il ne reste que 13 h 45 → 14 h (15 min).
    expect(
      await findMeetupCandidates(group, { ...req, personIds: ["a", "b"] }, estimated()),
    ).toHaveLength(1);
    expect(await findMeetupCandidates(group, req, estimated())).toEqual([]);
    // Avec un minimum de 15 min, le créneau de 15 min est proposé.
    const short = await findMeetupCandidates(
      group,
      { ...req, minDurationMinutes: 15 },
      estimated(),
    );
    expect(short).toHaveLength(1);
    expect(minutesBetween(short[0].start, short[0].end)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Autres règles
// ---------------------------------------------------------------------------

describe("findMeetupCandidates : règles générales", () => {
  it("applique exactement la formule avec un faux fournisseur", async () => {
    const A: Place = { id: "A", name: "A", lat: 0, lng: 0 };
    const B: Place = { id: "B", name: "B", lat: 0, lng: 0 };
    const P: Place = { id: "P", name: "P", lat: 0, lng: 0 };
    const D = WEEK.jeu;
    const x: Person = {
      id: "x",
      name: "X",
      homePlaceId: "A",
      travelMode: "car",
      places: [A, B, P],
      busyBlocks: [
        {
          id: "1",
          start: zonedTime(D, "08:00"),
          end: zonedTime(D, "10:00"),
          placeId: "A",
          title: "",
        },
        {
          id: "2",
          start: zonedTime(D, "12:00"),
          end: zonedTime(D, "22:00"),
          placeId: "B",
          title: "",
        },
      ],
    };
    const fake = new FakeTravelProvider([
      ["A", "P", 15],
      ["P", "B", 20],
    ]);
    const out = await findMeetupCandidates(
      [x],
      request({ personIds: ["x"], dates: { from: D, to: D }, candidatePlaceIds: ["P"] }),
      fake,
    );
    expect(out).toEqual([
      {
        placeId: "P",
        start: zonedTime(D, "10:20"),
        end: zonedTime(D, "11:35"),
        kind: "in-person",
        travelByPerson: { x: { to: 15, from: 20 } },
        score: 0,
      },
    ]);
  });

  it("lieux candidats par défaut : lieux des participants + favoris du groupe", async () => {
    const out = await findMeetupCandidates(
      [ali, sam],
      request({
        personIds: ["ali", "sam"],
        dates: { from: WEEK.sam, to: WEEK.sam },
        favoritePlaces: GROUP_FAVORITES,
      }),
      estimated(),
    );
    const places = new Set(out.map((p) => p.placeId));
    // Samedi : personne n'a de cours, tous les lieux sont possibles.
    expect(places).toEqual(
      new Set([
        PLACES.aliHome.id,
        PLACES.cegepEM.id,
        PLACES.samHome.id,
        PLACES.cafeLongueuil.id,
        PLACES.parcJeanDrapeau.id,
      ]),
    );
  });

  it("candidatePlaceIds restreint les lieux ; un lieu inconnu est refusé", async () => {
    const req = request({
      personIds: ["ali", "sam"],
      dates: { from: WEEK.sam, to: WEEK.sam },
      candidatePlaceIds: [PLACES.cegepEM.id],
    });
    const out = await findMeetupCandidates([ali, sam], req, estimated());
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.placeId === PLACES.cegepEM.id)).toBe(true);

    await expect(
      findMeetupCandidates([ali, sam], { ...req, candidatePlaceIds: ["nulle-part"] }, estimated()),
    ).rejects.toThrow(/inconnu/);
  });

  it("personne inconnue ou durée invalide : erreur claire", async () => {
    await expect(
      findMeetupCandidates(PEOPLE, request({ personIds: ["fantome"] }), estimated()),
    ).rejects.toThrow(/Personne inconnue/);
    await expect(
      findMeetupCandidates(
        PEOPLE,
        request({ personIds: ["ali"], minDurationMinutes: 0 }),
        estimated(),
      ),
    ).rejects.toThrow();
  });

  it("aucun participant : aucune proposition", async () => {
    expect(await findMeetupCandidates(PEOPLE, request({ personIds: [] }), estimated())).toEqual([]);
  });

  it("la marge réduit le créneau quand il y a un trajet", async () => {
    const base = request({
      personIds: ["ali", "sam"],
      dates: { from: WEEK.sam, to: WEEK.sam },
      candidatePlaceIds: [PLACES.parcJeanDrapeau.id],
      favoritePlaces: GROUP_FAVORITES,
    });
    const [sans] = await findMeetupCandidates(
      [ali, sam],
      { ...base, bufferMinutes: 0 },
      estimated(),
    );
    const [avec] = await findMeetupCandidates(
      [ali, sam],
      { ...base, bufferMinutes: 10 },
      estimated(),
    );
    expect(minutesBetween(avec.start, avec.end)).toBe(minutesBetween(sans.start, sans.end) - 20);
  });

  it("plage de plusieurs jours : propositions sur chaque jour, en ordre chronologique", async () => {
    const out = await findMeetupCandidates(
      [ali, sam],
      request({ personIds: ["ali", "sam"], dates: { from: WEEK.lun, to: WEEK.dim } }),
      estimated(),
    );
    const days = new Set(out.map((p) => formatInTimeZone(p.start, TIME_ZONE, "yyyy-MM-dd")));
    expect(days.size).toBe(7);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start.getTime()).toBeGreaterThanOrEqual(out[i - 1].start.getTime());
    }
  });

  it("chaque proposition respecte les blocs occupés, les trajets et la marge de chacun", async () => {
    const buffer = 5;
    const everyone = PEOPLE.map((p) => p.id);
    const out = await findMeetupCandidates(
      PEOPLE,
      request({
        personIds: everyone,
        dates: { from: WEEK.lun, to: WEEK.dim },
        minDurationMinutes: 45,
        bufferMinutes: buffer,
        favoritePlaces: GROUP_FAVORITES,
      }),
      estimated(),
    );
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(minutesBetween(p.start, p.end)).toBeGreaterThanOrEqual(45);
      for (const person of PEOPLE) {
        const leg = p.travelByPerson[person.id];
        expect(leg).toBeDefined();
        const leave = p.start.getTime() - (leg.to > 0 ? leg.to + buffer : 0) * 60_000;
        const back = p.end.getTime() + (leg.from > 0 ? leg.from + buffer : 0) * 60_000;
        for (const blk of person.busyBlocks) {
          const conflict = blk.start.getTime() < back && blk.end.getTime() > leave;
          expect(conflict, `${person.name} / ${blk.title} / ${p.placeId}`).toBe(false);
        }
      }
    }
  });

  it("bloc de travail de Léo : aucune rencontre avec lui pendant son quart", async () => {
    const out = await findMeetupCandidates(
      [leo, maya],
      request({ personIds: ["leo", "maya"], dates: { from: WEEK.lun, to: WEEK.lun } }),
      estimated(),
    );
    const shift: BusyBlock = leo.busyBlocks[0];
    expect(out.filter((p) => overlaps(p, shift.start, shift.end))).toEqual([]);
  });
});
