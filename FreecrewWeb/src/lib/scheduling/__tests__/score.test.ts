import { describe, expect, it } from "vitest";

import { DEFAULT_WEIGHTS, overlapRatio, scoreBreakdown, scoreProposal } from "../score";
import { addMinutesTo, zonedTime } from "../time";
import type { MeetupProposal, TravelLeg } from "../types";

const D = "2025-09-16";

function proposal(
  start: string,
  minutes: number,
  travel: Record<string, TravelLeg>,
  extra: Partial<MeetupProposal> = {},
): MeetupProposal {
  const s = zonedTime(D, start);
  return {
    kind: "in-person",
    placeId: "lieu",
    start: s,
    end: addMinutesTo(s, minutes),
    travelByPerson: travel,
    score: 0,
    ...extra,
  };
}

const zero = { to: 0, from: 0 };

describe("scoreProposal", () => {
  it("critère : « même lieu, 30 min » bat « 15 min de trajet chacun, 30 min »", () => {
    const memeLieu = proposal("12:00", 30, { a: zero, b: zero });
    const trajet = proposal("12:00", 30, { a: { to: 15, from: 15 }, b: { to: 15, from: 15 } });
    expect(scoreProposal(memeLieu)).toBeGreaterThan(scoreProposal(trajet));
  });

  it("plus long = mieux", () => {
    const court = proposal("12:00", 30, { a: zero });
    const long = proposal("12:00", 90, { a: zero });
    expect(scoreProposal(long)).toBeGreaterThan(scoreProposal(court));
  });

  it("au-delà du plafond de durée, plus long ne rapporte plus", () => {
    const cap = DEFAULT_WEIGHTS.durationCapMinutes;
    expect(scoreProposal(proposal("08:00", cap + 300, { a: zero }))).toBe(
      scoreProposal(proposal("08:00", cap, { a: zero })),
    );
  });

  it("trajet total plus court = mieux", () => {
    const proche = proposal("12:00", 60, { a: { to: 10, from: 10 }, b: { to: 10, from: 10 } });
    const loin = proposal("12:00", 60, { a: { to: 25, from: 25 }, b: { to: 25, from: 25 } });
    expect(scoreProposal(proche)).toBeGreaterThan(scoreProposal(loin));
  });

  it("à trajet total égal, trajet réparti équitablement = mieux", () => {
    const equitable = proposal("12:00", 60, { a: { to: 15, from: 15 }, b: { to: 15, from: 15 } });
    const inegal = proposal("12:00", 60, { a: { to: 30, from: 30 }, b: zero });
    expect(scoreBreakdown(equitable).totalTravel).toBe(scoreBreakdown(inegal).totalTravel);
    expect(scoreProposal(equitable)).toBeGreaterThan(scoreProposal(inegal));
  });

  it("plus tôt dans la semaine = un peu mieux", () => {
    const ref = zonedTime(D, "00:00");
    const mardi = proposal("12:00", 60, { a: zero });
    const jeudi = {
      ...mardi,
      start: zonedTime("2025-09-18", "12:00"),
      end: zonedTime("2025-09-18", "13:00"),
    };
    expect(scoreProposal(mardi, DEFAULT_WEIGHTS, { referenceTime: ref })).toBeGreaterThan(
      scoreProposal(jeudi, DEFAULT_WEIGHTS, { referenceTime: ref }),
    );
    // « un peu » : 30 min de plus ensemble valent plus que 2 jours d'attente.
    const jeudiLong = { ...jeudi, end: zonedTime("2025-09-18", "13:30") };
    expect(scoreProposal(jeudiLong, DEFAULT_WEIGHTS, { referenceTime: ref })).toBeGreaterThan(
      scoreProposal(mardi, DEFAULT_WEIGHTS, { referenceTime: ref }),
    );
  });

  it("sans instant de référence, la date ne compte pas", () => {
    const a = proposal("12:00", 60, { a: zero });
    const b = {
      ...a,
      start: zonedTime("2025-09-20", "12:00"),
      end: zonedTime("2025-09-20", "13:00"),
    };
    expect(scoreProposal(a)).toBe(scoreProposal(b));
  });

  it("un appel vaut moins qu'une rencontre en personne équivalente", () => {
    const enPersonne = proposal("12:00", 60, { a: zero, b: zero });
    const appel = proposal("12:00", 60, { a: zero, b: zero }, { kind: "call", placeId: null });
    expect(scoreProposal(appel)).toBe(scoreProposal(enPersonne) - DEFAULT_WEIGHTS.callPenalty);
  });

  it("les poids sont ajustables", () => {
    const p = proposal("12:00", 60, { a: { to: 30, from: 30 } });
    const sansTrajet = { ...DEFAULT_WEIGHTS, perHourTotalTravel: 0, perHourTravelSpread: 0 };
    expect(scoreProposal(p, sansTrajet)).toBe(DEFAULT_WEIGHTS.perHourTogether);
  });

  it("détail du score cohérent avec le total", () => {
    const p = proposal("12:00", 45, { a: { to: 10, from: 20 }, b: { to: 5, from: 5 } });
    const d = scoreBreakdown(p, DEFAULT_WEIGHTS, { referenceTime: zonedTime(D, "00:00") });
    expect(d.total).toBeCloseTo(d.duration + d.totalTravel + d.travelSpread + d.lateness + d.call);
    expect(d.duration).toBeCloseTo(0.75 * DEFAULT_WEIGHTS.perHourTogether);
    expect(d.totalTravel).toBeCloseTo(-(40 / 60) * DEFAULT_WEIGHTS.perHourTotalTravel);
    expect(d.travelSpread).toBeCloseTo(-(20 / 60) * DEFAULT_WEIGHTS.perHourTravelSpread);
  });
});

describe("overlapRatio", () => {
  const iv = (s: string, e: string) => ({ start: zonedTime(D, s), end: zonedTime(D, e) });

  it("rapport à la durée du plus court", () => {
    expect(overlapRatio(iv("12:00", "13:00"), iv("12:30", "13:30"))).toBe(0.5);
    expect(overlapRatio(iv("12:00", "14:00"), iv("12:30", "13:00"))).toBe(1);
    expect(overlapRatio(iv("12:00", "13:00"), iv("13:00", "14:00"))).toBe(0);
    expect(overlapRatio(iv("12:00", "13:00"), iv("15:00", "16:00"))).toBe(0);
  });
});
