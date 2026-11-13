import { describe, expect, it } from "vitest";

import type { BusyBlockInput } from "@/lib/db/convert";
import { zonedTime } from "@/lib/scheduling/time";

import { computePlanReviews, MAX_REVIEW_PLANS, reviewTargets, withReview } from "../review";
import type { PlanView } from "../view";

const now = zonedTime("2026-11-10", "10:00");

function view(id: string, day: string, over: Partial<PlanView> = {}): PlanView {
  return {
    id,
    groupId: "g",
    groupName: "Gang",
    title: "Souper",
    dayLabel: "",
    timeLabel: "",
    startsAt: zonedTime(day, "18:00").toISOString(),
    endsAt: zonedTime(day, "20:00").toISOString(),
    where: "Café",
    creatorName: "Sam",
    isMine: false,
    invited: true,
    myResponse: "yes",
    state: "upcoming",
    accepted: ["Ali", "Sam"],
    declined: [],
    waiting: [],
    wholeGroup: true,
    repeatLabel: null,
    series: null,
    placeId: null,
    going: [
      { id: "ali", name: "Ali" },
      { id: "sam", name: "Sam" },
      { id: "zoe", name: "Zoé" },
    ],
    ...over,
  };
}

function row(
  id: string,
  owner: string,
  from: string,
  to: string,
  over: Partial<BusyBlockInput> = {},
): BusyBlockInput {
  return {
    id,
    owner_id: owner,
    title: id,
    place_id: null,
    start_time: `${from}:00`,
    end_time: `${to}:00`,
    weekday: null,
    valid_from: "2026-11-12",
    valid_until: null,
    ...over,
  };
}

/** Le bloc du plan lui-même, dans l'horaire de chaque personne qui y va. */
const own = ["ali", "sam", "zoe"].map((p) => row(`plan-${p}`, p, "18:00", "20:00"));

describe("reviewTargets", () => {
  it("garde mes prochains plans (acceptés ou proposés par moi), les plus proches d'abord", () => {
    const views = [
      view("loin", "2027-06-01"),
      view("refuse", "2026-11-12", { myResponse: "no" }),
      view("a-moi", "2026-11-14", { isMine: true, myResponse: null }),
      view("accepte", "2026-11-12"),
      view("passe", "2026-11-01", { state: "past" }),
      view("annule", "2026-11-12", { state: "cancelled" }),
    ];
    expect(reviewTargets(views, now).map((v) => v.id)).toEqual(["accepte", "a-moi"]);
  });

  it("au plus MAX_REVIEW_PLANS plans", () => {
    const views = Array.from({ length: 20 }, (_, i) => view(`p${i}`, "2026-11-12"));
    expect(reviewTargets(views, now)).toHaveLength(MAX_REVIEW_PLANS);
  });
});

describe("computePlanReviews", () => {
  const plan = view("p", "2026-11-12");

  it("rien quand chacun n'a que le bloc du plan", () => {
    expect(computePlanReviews([plan], new Map([["g", own]]), "ali").size).toBe(0);
  });

  it("mon nouveau bloc : titre et heures ; celui d'un autre : seulement son nom", () => {
    const rows = [
      ...own,
      row("Labo", "ali", "17:00", "19:00"),
      row("Occupé", "sam", "19:00", "21:00"),
    ];
    const r = computePlanReviews([plan], new Map([["g", rows]]), "ali").get("p");
    expect(r).toEqual({
      mine: "Tu as maintenant « Labo » de 17 h à 19 h, en même temps que ce plan.",
      others: "Sam n'est plus libre à ce moment-là.",
    });
  });

  it("plusieurs personnes, en anglais", () => {
    const rows = [...own, row("x", "sam", "19:00", "21:00"), row("y", "zoe", "18:30", "19:00")];
    const r = computePlanReviews([plan], new Map([["g", rows]]), "ali", "en").get("p");
    expect(r).toEqual({ mine: null, others: "Sam and Zoé are no longer free at that time." });
  });

  it("un cours hebdomadaire compte, sauf si cette occurrence est annulée", () => {
    const cours = row("Cours du soir", "zoe", "18:00", "21:00", {
      weekday: 4,
      valid_from: "2026-08-24",
      valid_until: "2026-12-18",
    });
    const blocks = (c: BusyBlockInput) => new Map([["g", [...own, c]]]);
    expect(computePlanReviews([plan], blocks(cours), "ali").get("p")?.others).toBe(
      "Zoé n'est plus libre à ce moment-là.",
    );
    const annule = { ...cours, skip_days: ["2026-11-12"] };
    expect(computePlanReviews([plan], blocks(annule), "ali").size).toBe(0);
  });

  it("ignore quelqu'un qui n'y va pas, et un groupe dont l'horaire n'a pas pu être lu", () => {
    const rows = [...own, row("x", "luc", "18:00", "19:00")];
    expect(computePlanReviews([plan], new Map([["g", rows]]), "ali").size).toBe(0);
    expect(computePlanReviews([plan], new Map(), "ali").size).toBe(0);
  });
});

describe("withReview", () => {
  it("n'ajoute « à revoir » qu'aux plans concernés", () => {
    const views = [view("a", "2026-11-12"), view("b", "2026-11-13")];
    const out = withReview(views, new Map([["b", { mine: null, others: "Sam…" }]]));
    expect(out[0].review).toBeUndefined();
    expect(out[1].review).toEqual({ mine: null, others: "Sam…" });
  });
});
