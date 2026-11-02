import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import { findCallSlots, findMeetupCandidates, findMeetups, rankProposals } from "../findMeetups";
import { overlapRatio } from "../score";
import { EstimatedTravelProvider } from "../travel";
import { TIME_ZONE, addMinutesTo, zonedTime } from "../time";
import type { MeetupProposal, MeetupRequest, Person, Place, TravelLeg } from "../types";
import { FakeTravelProvider } from "./fakeTravel";
import { GROUP_FAVORITES, PEOPLE, PLACES, WEEK, ali, at, block, sam } from "./fixtures";

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

const D = WEEK.mar;

function prop(
  placeId: string | null,
  start: string,
  end: string,
  travel: TravelLeg = { to: 0, from: 0 },
): MeetupProposal {
  return {
    kind: placeId === null ? "call" : "in-person",
    placeId,
    start: zonedTime(D, start),
    end: zonedTime(D, end),
    travelByPerson: { a: travel },
    score: 0,
  };
}

const placeMap = (places: Place[]) => new Map(places.map((p) => [p.id, p]));
const X: Place = { id: "X", name: "X", lat: 45.5, lng: -73.6 };
const Y: Place = { id: "Y", name: "Y", lat: 45.6, lng: -73.7 };
const X2: Place = { id: "X2", name: "X (copie)", lat: 45.5, lng: -73.6 };

function assertNoNearDuplicates(out: MeetupProposal[]) {
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (out[i].placeId === out[j].placeId) {
        expect(overlapRatio(out[i], out[j])).toBeLessThanOrEqual(0.8);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// rankProposals (pur)
// ---------------------------------------------------------------------------

describe("rankProposals", () => {
  it("trie du meilleur score au moins bon", () => {
    const out = rankProposals(
      [
        prop("X", "12:00", "12:30", { to: 20, from: 20 }),
        prop("Y", "14:00", "15:30"),
        prop("X", "16:00", "16:30"),
      ],
      placeMap([X, Y]),
    );
    expect(out.map((p) => p.placeId + "@" + formatInTimeZone(p.start, TIME_ZONE, "HH:mm"))).toEqual(
      ["Y@14:00", "X@16:00", "X@12:00"],
    );
    for (let i = 1; i < out.length; i++)
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("critère : retire la proposition au même lieu qui chevauche à plus de 80 %", () => {
    const out = rankProposals(
      [prop("X", "12:00", "13:00"), prop("X", "12:05", "13:00")],
      placeMap([X]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].start).toEqual(zonedTime(D, "12:00")); // la meilleure (plus longue) est gardée
  });

  it("garde deux propositions au même lieu qui se chevauchent peu (≤ 80 %)", () => {
    const peu = rankProposals(
      [prop("X", "12:00", "13:00"), prop("X", "12:45", "14:00")],
      placeMap([X]),
    );
    expect(peu).toHaveLength(2);
    // Exactement 80 % : gardé (la règle est « plus de 80 % »).
    const exact = rankProposals(
      [prop("X", "12:00", "13:00"), prop("X", "12:12", "13:12")],
      placeMap([X]),
    );
    expect(overlapRatio(exact[0], exact[1])).toBeCloseTo(0.8);
    expect(exact).toHaveLength(2);
  });

  it("deux lieux différents au même moment : les deux sont gardés", () => {
    const out = rankProposals(
      [prop("X", "12:00", "13:00"), prop("Y", "12:00", "13:00")],
      placeMap([X, Y]),
    );
    expect(out).toHaveLength(2);
  });

  it("deux identifiants pour le même endroit (mêmes coordonnées) : doublon retiré", () => {
    const out = rankProposals(
      [prop("X", "12:00", "13:00"), prop("X2", "12:00", "13:00")],
      placeMap([X, X2]),
    );
    expect(out).toHaveLength(1);
  });

  it("au plus maxPerDay propositions par jour local (défaut 3)", () => {
    const many = ["08:00", "09:00", "10:00", "11:00", "12:00"].map((h, i) =>
      prop(
        i % 2 ? "X" : "Y",
        h,
        formatInTimeZone(addMinutesTo(zonedTime(D, h), 45), TIME_ZONE, "HH:mm"),
      ),
    );
    const other = {
      ...prop("X", "12:00", "13:00"),
      start: zonedTime(WEEK.mer, "12:00"),
      end: zonedTime(WEEK.mer, "13:00"),
    };
    expect(rankProposals([...many, other], placeMap([X, Y]))).toHaveLength(4);
    expect(rankProposals([...many, other], placeMap([X, Y]), { maxPerDay: 1 })).toHaveLength(2);
  });

  it("calcule le score (référence : début de période)", () => {
    const [p] = rankProposals([prop("X", "12:00", "13:00")], placeMap([X]));
    expect(p.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findMeetups (classé)
// ---------------------------------------------------------------------------

describe("findMeetups : classement", () => {
  it("critère : même lieu (30 min) avant un lieu à 15 min de trajet chacun (30 min)", async () => {
    // a et b sont au lieu S de 11 h à 12 h et de 12 h 30 à 22 h ; on cherche midi.
    const S: Place = { id: "S", name: "Cégep", lat: 45.5, lng: -73.5 };
    const C: Place = { id: "C", name: "Café", lat: 45.51, lng: -73.51 };
    const mk = (id: string): Person => ({
      id,
      name: id,
      homePlaceId: "S",
      travelMode: "walk",
      places: [S, C],
      busyBlocks: [
        block(`${id}-1`, "mar", "08:00", "12:00", "S", "Cours"),
        block(`${id}-2`, "mar", "13:00", "22:00", "S", "Cours"),
      ],
    });
    const fake = new FakeTravelProvider([["S", "C", 15]]);
    const req = request({
      personIds: ["a", "b"],
      dates: { from: D, to: D },
      minDurationMinutes: 20,
      bufferMinutes: 0,
    });
    const out = await findMeetups([mk("a"), mk("b")], req, fake);
    // S : 12:00 → 13:00 (60 min, 0 trajet) ; C : 12:15 → 12:45 (30 min, 15 + 15 chacun).
    expect(out.map((p) => p.placeId)).toEqual(["S", "C"]);

    // Même comparaison à durée égale (30 min chacun) : le même lieu gagne.
    const raw = await findMeetupCandidates([mk("a"), mk("b")], req, fake);
    const s30 = {
      ...raw.find((p) => p.placeId === "S")!,
      start: zonedTime(D, "12:15"),
      end: zonedTime(D, "12:45"),
    };
    const c30 = raw.find((p) => p.placeId === "C")!;
    const ranked = rankProposals([c30, s30], placeMap([S, C]));
    expect(ranked[0].placeId).toBe("S");
  });

  it("au plus 3 propositions par jour par défaut, option maxPerDay", async () => {
    const req = request({
      personIds: ["ali", "sam"],
      dates: { from: WEEK.sam, to: WEEK.sam },
      favoritePlaces: GROUP_FAVORITES,
    });
    expect((await findMeetupCandidates([ali, sam], req, estimated())).length).toBe(5);
    expect(await findMeetups([ali, sam], req, estimated())).toHaveLength(3);
    expect(await findMeetups([ali, sam], req, estimated(), { maxPerDay: 1 })).toHaveLength(1);
  });

  it("le lieu le plus pratique d'abord : samedi, ali et Sam libres toute la journée", async () => {
    const out = await findMeetups(
      [ali, sam],
      request({
        personIds: ["ali", "sam"],
        dates: { from: WEEK.sam, to: WEEK.sam },
        favoritePlaces: GROUP_FAVORITES,
      }),
      estimated(),
    );
    // Le plus loin de tout le monde (parc Jean-Drapeau, en transport) n'est pas premier.
    expect(out[0].placeId).not.toBe(PLACES.parcJeanDrapeau.id);
    for (let i = 1; i < out.length; i++)
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("critère : jamais deux propositions au même lieu qui se chevauchent à plus de 80 % (toute la semaine)", async () => {
    const out = await findMeetups(
      PEOPLE,
      request({
        personIds: PEOPLE.map((p) => p.id),
        dates: { from: WEEK.lun, to: WEEK.dim },
        favoritePlaces: GROUP_FAVORITES,
      }),
      estimated(),
      { maxPerDay: 10 },
    );
    expect(out.length).toBeGreaterThan(0);
    assertNoNearDuplicates(out);
  });

  it("deux amis qui ont enregistré chacun leur cégep (deux id, même endroit) : pas de doublon", async () => {
    const cegepSam: Place = { ...PLACES.cegepEM, id: "cegep-em-de-sam" };
    const sam2: Person = {
      ...sam,
      places: [PLACES.samHome, cegepSam],
      busyBlocks: sam.busyBlocks.map((b) => ({
        ...b,
        placeId: b.placeId === PLACES.cegepEM.id ? cegepSam.id : b.placeId,
      })),
    };
    const req = request({
      personIds: ["ali", "sam"],
      dates: { from: D, to: D },
      minDurationMinutes: 20,
    });
    const raw = await findMeetupCandidates([ali, sam2], req, estimated());
    const midi = (p: MeetupProposal) => p.start.getTime() === at("mar", "12:00").getTime();
    expect(raw.filter(midi)).toHaveLength(2); // les deux « cégeps »
    const out = await findMeetups([ali, sam2], req, estimated(), { maxPerDay: 10 });
    expect(out.filter(midi)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Appel / visio
// ---------------------------------------------------------------------------

describe("findMeetups : appel/visio", () => {
  // L'ami est à l'UdeM le lundi avant et après la pause d'ali (10 h → 11 h).
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
  const morning = request({
    personIds: ["ali", "ami"],
    dayHours: { start: "08:00", end: "13:00" },
  });

  it("cas « ali » : aucune rencontre possible, mais un appel pendant la pause commune", async () => {
    const out = await findMeetups([ali, ami], morning, estimated());
    expect(out).toEqual([
      {
        kind: "call",
        placeId: null,
        start: at("lun", "10:00"),
        end: at("lun", "11:00"),
        travelByPerson: { ali: { to: 0, from: 0 }, ami: { to: 0, from: 0 } },
        score: expect.any(Number),
      },
    ]);
  });

  it("pas d'appel proposé un jour où une rencontre en personne est possible", async () => {
    const out = await findMeetups(
      [ali, sam],
      request({ personIds: ["ali", "sam"], dates: { from: D, to: D }, minDurationMinutes: 20 }),
      estimated(),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.kind === "in-person")).toBe(true);
  });

  it("appel seulement les jours sans rencontre possible, sur une plage de plusieurs jours", async () => {
    const out = await findMeetups(
      [ali, ami],
      { ...morning, dates: { from: WEEK.lun, to: WEEK.sam } },
      estimated(),
    );
    const lundi = out.filter(
      (p) => formatInTimeZone(p.start, TIME_ZONE, "yyyy-MM-dd") === WEEK.lun,
    );
    const samedi = out.filter(
      (p) => formatInTimeZone(p.start, TIME_ZONE, "yyyy-MM-dd") === WEEK.sam,
    );
    expect(lundi.map((p) => p.kind)).toEqual(["call"]);
    // Samedi matin, les deux sont libres : rencontre en personne, donc pas d'appel.
    expect(samedi.length).toBeGreaterThan(0);
    expect(samedi.every((p) => p.kind === "in-person")).toBe(true);
  });

  it("option includeCalls: false : aucun appel", async () => {
    expect(await findMeetups([ali, ami], morning, estimated(), { includeCalls: false })).toEqual(
      [],
    );
  });

  it("aucun trou commun assez long : ni rencontre ni appel", async () => {
    expect(
      await findMeetups([ali, ami], { ...morning, minDurationMinutes: 90 }, estimated()),
    ).toEqual([]);
  });

  it("findCallSlots : trous communs sans trajet, durée minimale respectée", () => {
    const slots = findCallSlots([ali, ami], { ...morning, minDurationMinutes: 60 }, WEEK.lun);
    expect(slots).toHaveLength(1);
    expect(findCallSlots([ali, ami], { ...morning, minDurationMinutes: 61 }, WEEK.lun)).toEqual([]);
  });
});
