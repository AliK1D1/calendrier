import { describe, expect, it } from "vitest";

import { clipToHorizon, findMeetupSoon, FREE_NOW_HORIZON_MINUTES, freeNowRange } from "../freeNow";
import { zonedTime } from "../time";
import type { MeetupProposal, Person } from "../types";
import { FakeTravelProvider } from "./fakeTravel";
import { PLACES, ali, at, sam } from "./fixtures";

const travel = () => new FakeTravelProvider([], 10);

describe("freeNowRange", () => {
  it("un seul jour local en journée", () => {
    expect(freeNowRange(at("lun", "14:00"))).toEqual({ from: "2025-09-15", to: "2025-09-15" });
  });

  it("deux jours quand l'horizon passe minuit (fuseau de Montréal, pas UTC)", () => {
    expect(freeNowRange(at("lun", "23:30"))).toEqual({ from: "2025-09-15", to: "2025-09-16" });
    // 22 h 00 + 2 h = minuit pile : le lendemain n'est pas touché.
    expect(freeNowRange(at("lun", "22:00"))).toEqual({ from: "2025-09-15", to: "2025-09-15" });
  });

  it("l'horizon par défaut est de 2 heures", () => {
    expect(FREE_NOW_HORIZON_MINUTES).toBe(120);
  });
});

describe("clipToHorizon", () => {
  const p: MeetupProposal = {
    kind: "in-person",
    placeId: "x",
    start: at("lun", "16:00"),
    end: at("lun", "21:00"),
    travelByPerson: {},
    score: 0,
  };

  it("coupe la fin à l'horizon et garde le reste s'il dure assez", () => {
    expect(clipToHorizon(p, at("lun", "16:30"), 30)?.end).toEqual(at("lun", "16:30"));
  });

  it("refuse ce qui reste trop court ; ne touche pas une proposition déjà dans l'horizon", () => {
    expect(clipToHorizon(p, at("lun", "16:20"), 30)).toBeNull();
    expect(clipToHorizon(p, at("lun", "23:00"), 30)).toBe(p);
  });
});

describe("findMeetupSoon (« Je suis libre maintenant »)", () => {
  it("mardi midi, ali et Sam ont 30 min au cégep : en personne, sans trajet", async () => {
    const r = await findMeetupSoon([ali, sam], { now: at("mar", "12:00") }, travel());
    expect(r).toMatchObject({
      kind: "in-person",
      placeId: PLACES.cegepEM.id,
      start: at("mar", "12:00"),
      end: at("mar", "12:30"),
    });
    expect(r?.travelByPerson).toEqual({ ali: { to: 0, from: 0 }, sam: { to: 0, from: 0 } });
  });

  it("maintenant est arrondi au quart d'heure suivant : 11 h 58 trouve 12 h, 12 h 05 ne trouve plus rien", async () => {
    const tot = await findMeetupSoon([ali, sam], { now: at("mar", "11:58") }, travel());
    expect(tot?.start).toEqual(at("mar", "12:00"));
    // 12 h 15 → 12 h 30 : 15 min seulement, ni en personne ni en appel.
    expect(await findMeetupSoon([ali, sam], { now: at("mar", "12:05") }, travel())).toBeNull();
  });

  it("la rencontre doit tenir dans les 2 heures : lundi 14 h 30, ali sort à 16 h → 16 h à 16 h 30", async () => {
    const r = await findMeetupSoon([ali, sam], { now: at("lun", "14:30") }, travel());
    expect(r).toMatchObject({
      kind: "in-person",
      placeId: PLACES.cegepEM.id,
      start: at("lun", "16:00"),
      end: at("lun", "16:30"),
    });
    // Avec 89 min d'horizon (fin à 15 h 59), plus rien.
    expect(
      await findMeetupSoon([ali, sam], { now: at("lun", "14:30"), horizonMinutes: 89 }, travel()),
    ).toBeNull();
  });

  it("lundi 10 h : ali est libre, Sam en cours, puis l'inverse : personne", async () => {
    expect(await findMeetupSoon([ali, sam], { now: at("lun", "10:00") }, travel())).toBeNull();
  });

  it("après les heures de la journée (22 h), rien n'est proposé", async () => {
    expect(await findMeetupSoon([ali, sam], { now: at("lun", "21:45") }, travel())).toBeNull();
  });

  it("trop loin pour se rejoindre à temps : un appel sur le trou commun", async () => {
    const loin: Person = {
      id: "loin",
      name: "Loin",
      homePlaceId: "quebec",
      travelMode: "car",
      places: [{ id: "quebec", name: "Québec", lat: 46.81, lng: -71.21 }],
      busyBlocks: [],
    };
    const provider = new FakeTravelProvider(
      [
        ["quebec", PLACES.cegepEM.id, 180],
        ["quebec", PLACES.aliHome.id, 180],
      ],
      10,
    );
    const r = await findMeetupSoon([ali, loin], { now: at("lun", "10:00") }, provider);
    expect(r).toMatchObject({
      kind: "call",
      placeId: null,
      start: at("lun", "10:00"),
      end: at("lun", "11:00"),
    });
  });

  it("préfère la rencontre la plus tôt, puis le moins de trajet", async () => {
    // Samedi 14 h, personne n'a de bloc : tous les lieux sont possibles dès 14 h ; une des
    // deux maisons (0 + 10 min de trajet) gagne sur le cégep (25 + 25 min).
    const r = await findMeetupSoon(
      [ali, sam],
      { now: zonedTime("2025-09-20", "14:00") },
      new FakeTravelProvider([[PLACES.aliHome.id, PLACES.samHome.id, 10]], 25),
    );
    expect(r?.kind).toBe("in-person");
    expect([PLACES.aliHome.id, PLACES.samHome.id]).toContain(r?.placeId);
    expect(r?.start).toEqual(zonedTime("2025-09-20", "14:00"));
  });

  it("refuse un horizon invalide ; un seul participant ne donne rien", async () => {
    await expect(
      findMeetupSoon([ali, sam], { now: at("lun", "10:00"), horizonMinutes: 0 }, travel()),
    ).rejects.toThrow();
    expect(await findMeetupSoon([ali], { now: at("lun", "10:00") }, travel())).toBeNull();
  });
});
