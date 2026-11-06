import { describe, expect, it } from "vitest";

import { explainNoMeetup, explainSentence, type AlmostMeetup } from "../explainNoMeetup";
import { findMeetupCandidates } from "../findMeetups";
import { zonedTime } from "../time";
import type { BusyBlock, MeetupRequest, Person, Place } from "../types";
import { FakeTravelProvider } from "./fakeTravel";

const D = "2025-09-16"; // mardi, heure avancée
const DST = "2026-11-01"; // dimanche : retour à l'heure normale (journée de 25 h)

const place = (id: string, name: string): Place => ({ id, name, lat: 45.5, lng: -73.5 });
const CEGEP = place("cegep", "Cégep");
const CAFE = place("cafe", "Café du coin");
const TRAVAIL = place("travail", "Lieu secret du travail");
const HOMES = {
  lea: place("maison-lea", "Maison de Léa"),
  sam: place("maison-sam", "Maison de Sam"),
  ali: place("maison-ali", "Maison d'ali"),
};

let blockId = 0;
function busy(day: string, start: string, end: string, at: Place, title = "Cours"): BusyBlock {
  blockId++;
  return {
    id: `b${blockId}`,
    start: zonedTime(day, start),
    end: zonedTime(day, end),
    placeId: at.id,
    title,
  };
}

function person(id: keyof typeof HOMES, name: string, blocks: BusyBlock[], extra: Place[] = []) {
  const home = HOMES[id];
  const places = [home, CEGEP, ...extra];
  return {
    id,
    name,
    homePlaceId: home.id,
    travelMode: "transit",
    busyBlocks: blocks,
    places,
  } satisfies Person;
}

function request(day: string, ids: string[], overrides: Partial<MeetupRequest> = {}) {
  return {
    personIds: ids,
    dates: { from: day, to: day },
    minDurationMinutes: 60,
    bufferMinutes: 5,
    ...overrides,
  } satisfies MeetupRequest;
}

/** Trajets : maisons à 30 min de tout (valeur par défaut). */
const travel = () =>
  new FakeTravelProvider([
    ["cegep", "travail", 35],
    ["cegep", "cafe", 10],
    ["travail", "cafe", 30],
  ]);

describe("explainNoMeetup", () => {
  it("pause de 1 h au cégep, ami à 40 min : Sam limite par le trajet, compromis : réduire ou appel", async () => {
    const lea = person("lea", "Léa", [
      busy(D, "08:00", "12:00", CEGEP),
      busy(D, "13:00", "22:00", CEGEP),
    ]);
    const sam = person(
      "sam",
      "Sam",
      [busy(D, "08:00", "12:00", TRAVAIL, "Quart chez X"), busy(D, "14:00", "22:00", TRAVAIL)],
      [TRAVAIL],
    );
    const req = request(D, ["lea", "sam"], { minDurationMinutes: 30 });

    expect(await findMeetupCandidates([lea, sam], req, travel())).toEqual([]);
    const out = await explainNoMeetup([lea, sam], req, travel());

    expect(out).toHaveLength(1);
    const [a] = out;
    expect(a.placeId).toBe("cegep");
    expect(a.start).toEqual(zonedTime(D, "12:40"));
    expect(a.end).toEqual(zonedTime(D, "13:00"));
    expect(a.sharedMinutes).toBe(20);
    expect(a.missingMinutes).toBe(10);
    expect(a.limiting?.personId).toBe("sam");
    expect(a.limiting?.causes).toEqual([
      {
        side: "arrival",
        reason: "travel",
        busyEdge: zonedTime(D, "12:00"),
        travelMinutes: 35,
        bufferMinutes: 5,
        cutMinutes: 40,
      },
    ]);
    expect(a.compromises).toEqual([
      { kind: "shorten", durationMinutes: 20 },
      { kind: "call", start: zonedTime(D, "12:00"), end: zonedTime(D, "13:00") },
    ]);
    expect(explainSentence(a, "Sam", "Cégep")).toBe(
      "C'est Sam qui écourte le moment à Cégep : occupé·e jusqu'à 12 h et il lui faut 35 min (+ 5 min de marge) pour s'y rendre.",
    );
    expect(explainSentence(a, "Sam", "Cégep", "en")).toBe(
      "Sam is the one who shortens the time at Cégep: busy until noon and needs 35 min (+ 5 min margin) to get there.",
    );
  });

  it("une personne manque 10 min : réduire à 50 min ou se voir sans elle", async () => {
    const libre = (id: "ali" | "sam", name: string) =>
      person(id, name, [busy(D, "08:00", "12:00", CEGEP), busy(D, "13:30", "22:00", CEGEP)]);
    const lea = person("lea", "Léa", [
      busy(D, "08:00", "12:00", CEGEP),
      busy(D, "12:50", "22:00", CEGEP, "Rendez-vous privé"),
    ]);
    const people = [libre("ali", "ali"), lea, libre("sam", "Sam")];
    const req = request(D, ["ali", "lea", "sam"]);

    const out = await explainNoMeetup(people, req, travel());
    expect(out).toHaveLength(1);
    const [a] = out;
    expect(a).toMatchObject({ placeId: "cegep", sharedMinutes: 50, missingMinutes: 10 });
    expect(a.limiting?.personId).toBe("lea");
    expect(a.limiting?.causes).toMatchObject([
      { side: "departure", reason: "busy", busyEdge: zonedTime(D, "12:50"), cutMinutes: 40 },
    ]);
    expect(a.compromises).toEqual([
      { kind: "shorten", durationMinutes: 50 },
      {
        kind: "without",
        personId: "lea",
        start: zonedTime(D, "12:00"),
        end: zonedTime(D, "13:30"),
      },
    ]);
    expect(explainSentence(a, "Léa", "Cégep")).toBe(
      "Léa n'a que 50 min à Cégep : occupé·e dès 12 h 50.",
    );
    expect(explainSentence(a, "Léa", "Cégep", "en")).toBe(
      "Léa only has 50 min at Cégep: busy from 12:50 PM.",
    );

    // Confidentialité : ni titre de bloc ni lieu d'avant/après dans le résultat.
    const json = JSON.stringify(out);
    expect(json).not.toContain("Rendez-vous privé");
    expect(json).not.toContain("Cours");
  });

  it("propose un autre lieu où ça marche, et ne réduit jamais sous 15 min", async () => {
    const lea = person(
      "lea",
      "Léa",
      [busy(D, "08:00", "12:00", CEGEP), busy(D, "13:00", "22:00", CEGEP)],
      [CAFE],
    );
    const sam = person("sam", "Sam", [
      busy(D, "08:00", "12:00", CEGEP),
      busy(D, "13:00", "22:00", CEGEP),
    ]);
    // Café : 12 h 15 à 12 h 45 (30 min) ; au cégep : 1 h.
    const out = await explainNoMeetup([lea, sam], request(D, ["lea", "sam"]), travel());
    expect(out.map((a) => a.placeId)).toEqual(["cafe"]);
    expect(out[0].compromises).toEqual([
      { kind: "shorten", durationMinutes: 30 },
      {
        kind: "other-place",
        placeId: "cegep",
        start: zonedTime(D, "12:00"),
        end: zonedTime(D, "13:00"),
      },
      { kind: "call", start: zonedTime(D, "12:00"), end: zonedTime(D, "13:00") },
    ]);

    // Durée de 20 min, café seulement : 12 h 24 à 12 h 36 (12 min). Réduire à 10 min serait
    // sous le seuil de 15 min : il ne reste que l'appel.
    const short = await explainNoMeetup(
      [lea, sam],
      request(D, ["lea", "sam"], {
        minDurationMinutes: 20,
        bufferMinutes: 9,
        candidatePlaceIds: ["cafe"],
      }),
      new FakeTravelProvider([["cegep", "cafe", 15]]),
    );
    expect(short).toHaveLength(1);
    expect(short[0].sharedMinutes).toBe(12);
    expect(short[0].compromises).toEqual([
      { kind: "call", start: zonedTime(D, "12:00"), end: zonedTime(D, "13:00") },
    ]);
  });

  it("personne n'est libre en même temps : aucune explication", async () => {
    const lea = person("lea", "Léa", [busy(D, "08:00", "22:00", CEGEP)]);
    const sam = person("sam", "Sam", [busy(D, "08:00", "12:00", CEGEP)]);
    expect(await explainNoMeetup([lea, sam], request(D, ["lea", "sam"]), travel())).toEqual([]);
  });

  it("garde au plus 3 « presque », du plus proche au plus loin, un par jour et par lieu", async () => {
    const days = ["2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18"];
    const ends = ["12:35", "12:50", "12:40", "12:45"];
    const lea = person(
      "lea",
      "Léa",
      days.flatMap((d, i) => [busy(d, "08:00", "12:00", CEGEP), busy(d, ends[i], "22:00", CEGEP)]),
    );
    const sam = person(
      "sam",
      "Sam",
      days.flatMap((d) => [busy(d, "08:00", "12:00", CEGEP), busy(d, "14:00", "22:00", CEGEP)]),
    );
    const out = await explainNoMeetup(
      [lea, sam],
      request(days[0], ["lea", "sam"], { dates: { from: days[0], to: days[3] } }),
      travel(),
    );
    expect(out.map((a) => [a.day, a.missingMinutes])).toEqual([
      ["2025-09-16", 10],
      ["2025-09-18", 15],
      ["2025-09-17", 20],
    ]);
  });

  it("jour du changement d'heure (25 h) : heures locales justes", async () => {
    const libre = (id: "ali" | "sam", name: string) =>
      person(id, name, [busy(DST, "08:00", "12:00", CEGEP), busy(DST, "13:30", "22:00", CEGEP)]);
    const lea = person("lea", "Léa", [
      busy(DST, "08:00", "12:00", CEGEP),
      busy(DST, "12:50", "22:00", CEGEP),
    ]);
    const out = await explainNoMeetup(
      [libre("ali", "ali"), lea, libre("sam", "Sam")],
      request(DST, ["ali", "lea", "sam"]),
      travel(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].start).toEqual(zonedTime(DST, "12:00"));
    expect(out[0].end).toEqual(zonedTime(DST, "12:50"));
    expect(out[0].sharedMinutes).toBe(50);
    expect(explainSentence(out[0], "Léa", "Cégep")).toBe(
      "Léa n'a que 50 min à Cégep : occupé·e dès 12 h 50.",
    );
  });

  it("respecte « pas avant » : le moment commencé est raccourci", async () => {
    const lea = person("lea", "Léa", [
      busy(D, "08:00", "12:00", CEGEP),
      busy(D, "13:00", "22:00", CEGEP),
    ]);
    const sam = person("sam", "Sam", [
      busy(D, "08:00", "12:00", CEGEP),
      busy(D, "13:00", "22:00", CEGEP),
    ]);
    const out = await explainNoMeetup(
      [lea, sam],
      request(D, ["lea", "sam"], { notBefore: zonedTime(D, "12:20") }),
      travel(),
    );
    expect(out[0]).toMatchObject({ placeId: "cegep", sharedMinutes: 40, limiting: null });
    expect(explainSentence(out[0], null, "Cégep")).toBe(
      "Le moment commun à Cégep ne dure que 40 min : il manque 20 min.",
    );
  });

  it("refuse une durée minimale invalide et une personne inconnue", async () => {
    await expect(
      explainNoMeetup([], request(D, ["x"], { minDurationMinutes: Number.NaN }), travel()),
    ).rejects.toThrow();
    await expect(explainNoMeetup([], request(D, ["x", "y"]), travel())).rejects.toThrow(
      "Personne inconnue",
    );
  });
});

describe("explainSentence", () => {
  const base = (causes: NonNullable<AlmostMeetup["limiting"]>["causes"]) => ({
    sharedMinutes: 35,
    missingMinutes: 10,
    limiting: {
      personId: "lea",
      ownStart: zonedTime(D, "13:23"),
      ownEnd: zonedTime(D, "13:58"),
      causes,
    },
  });

  it("arrivée et départ, avec et sans marge", () => {
    expect(
      explainSentence(
        base([
          {
            side: "arrival",
            reason: "travel",
            busyEdge: zonedTime(D, "13:00"),
            travelMinutes: 18,
            bufferMinutes: 5,
            cutMinutes: 23,
          },
          {
            side: "departure",
            reason: "travel",
            busyEdge: zonedTime(D, "14:20"),
            travelMinutes: 22,
            bufferMinutes: 0,
            cutMinutes: 5,
          },
        ]),
        "Léa",
        "Café du coin",
      ),
    ).toBe(
      "Léa n'a que 35 min à Café du coin une fois le trajet compté : occupé·e jusqu'à 13 h et il lui faut 18 min (+ 5 min de marge) pour s'y rendre ; occupé·e dès 14 h 20 et il lui faut 22 min pour repartir.",
    );
  });
});
