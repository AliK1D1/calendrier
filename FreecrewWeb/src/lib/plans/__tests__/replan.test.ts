import { describe, expect, it } from "vitest";

import { zonedTime } from "@/lib/scheduling/time";

import { replanHref, replanRequest } from "../replan";
import type { PlanView } from "../view";

const limits = { min: 15, max: 120 };
const members = ["ali", "sam", "zoe"];

function view(over: Partial<PlanView> = {}): PlanView {
  return {
    id: "p",
    groupId: "g",
    groupName: "Gang",
    title: "Souper",
    dayLabel: "jeudi 12 novembre",
    timeLabel: "18 h – 20 h",
    startsAt: zonedTime("2026-11-12", "18:00").toISOString(),
    endsAt: zonedTime("2026-11-12", "20:00").toISOString(),
    where: "Café",
    creatorName: "Sam",
    isMine: false,
    invited: true,
    myResponse: "yes",
    state: "upcoming",
    accepted: [],
    declined: [],
    waiting: [],
    wholeGroup: true,
    repeatLabel: null,
    series: null,
    placeId: null,
    going: [
      { id: "ali", name: "Ali" },
      { id: "sam", name: "Sam" },
    ],
    ...over,
  };
}

describe("replanRequest", () => {
  it("reprend les personnes qui y vont et la durée du plan", () => {
    expect(replanRequest([view()], "p", members, limits)).toEqual({
      planId: "p",
      title: "Souper",
      when: "jeudi 12 novembre, 18 h – 20 h",
      participantIds: ["ali", "sam"],
      durationMinutes: 120,
      isMine: false,
    });
  });

  it("ramène la durée dans les bornes de la recherche, aux 5 minutes", () => {
    const long = view({ endsAt: zonedTime("2026-11-12", "24:00").toISOString() });
    expect(replanRequest([long], "p", members, limits)?.durationMinutes).toBe(120);
    const odd = view({ endsAt: zonedTime("2026-11-12", "18:52").toISOString() });
    expect(replanRequest([odd], "p", members, limits)?.durationMinutes).toBe(50);
  });

  it("tout le groupe quand il reste moins de 2 participants encore membres", () => {
    const r = replanRequest([view()], "p", ["ali", "zoe"], limits);
    expect(r?.participantIds).toEqual(["ali", "zoe"]);
  });

  it("rien pour un plan inconnu, passé, annulé, ou auquel je ne vais pas", () => {
    expect(replanRequest([view()], undefined, members, limits)).toBeNull();
    expect(replanRequest([view()], "autre", members, limits)).toBeNull();
    expect(replanRequest([view({ state: "past" })], "p", members, limits)).toBeNull();
    expect(replanRequest([view({ state: "cancelled" })], "p", members, limits)).toBeNull();
    expect(replanRequest([view({ myResponse: "no" })], "p", members, limits)).toBeNull();
    expect(
      replanRequest([view({ myResponse: null, isMine: true })], "p", members, limits),
    ).not.toBeNull();
  });
});

describe("replanHref", () => {
  it("mène à la recherche du groupe", () => {
    expect(replanHref({ id: "p", groupId: "g" })).toBe("/groupes/g?replanifier=p#se-voir");
  });
});
