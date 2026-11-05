import { describe, expect, it } from "vitest";

import type { PlanView } from "@/lib/plans/view";

import { homePlans } from "../homePlans";

function plan(id: string, startsAt: string, over: Partial<PlanView> = {}): PlanView {
  return {
    id,
    groupId: "g",
    groupName: "Gang",
    title: "On se voit",
    dayLabel: "",
    timeLabel: "",
    startsAt,
    endsAt: startsAt,
    where: "Café",
    creatorName: "Sam",
    isMine: false,
    invited: true,
    myResponse: null,
    state: "upcoming",
    accepted: [],
    declined: [],
    waiting: [],
    wholeGroup: true,
    ...over,
  };
}

describe("homePlans", () => {
  it("rien : listes vides", () => {
    expect(homePlans([])).toEqual({ awaiting: [], upcoming: [], moreUpcoming: 0 });
  });

  it("met tous les plans en attente de ma réponse, du plus proche au plus loin", () => {
    const r = homePlans([plan("b", "2026-11-09T18:00Z"), plan("a", "2026-11-07T18:00Z")]);
    expect(r.awaiting.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.upcoming).toEqual([]);
  });

  it("garde les 2 prochains plans acceptés ou proposés et compte le reste", () => {
    const r = homePlans([
      plan("loin", "2026-11-20T18:00Z", { myResponse: "yes" }),
      plan("mien", "2026-11-06T18:00Z", { isMine: true }),
      plan("proche", "2026-11-08T18:00Z", { myResponse: "yes" }),
    ]);
    expect(r.upcoming.map((p) => p.id)).toEqual(["mien", "proche"]);
    expect(r.moreUpcoming).toBe(1);
  });

  it("ignore les plans passés, annulés ou refusés", () => {
    const r = homePlans([
      plan("passe", "2026-10-01T18:00Z", { state: "past", myResponse: "yes" }),
      plan("annule", "2026-11-08T18:00Z", { state: "cancelled" }),
      plan("refuse", "2026-11-08T18:00Z", { myResponse: "no" }),
    ]);
    expect(r).toEqual({ awaiting: [], upcoming: [], moreUpcoming: 0 });
  });
});
