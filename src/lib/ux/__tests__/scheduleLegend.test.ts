import { describe, expect, it } from "vitest";

import { legendIsEmpty, scheduleLegend } from "../scheduleLegend";

describe("scheduleLegend", () => {
  it("semaine vide sans heures calmes : rien à expliquer", () => {
    const l = scheduleLegend([], { quiet: false });
    expect(legendIsEmpty(l)).toBe(true);
  });

  it("les heures calmes seules méritent une légende (hachures)", () => {
    expect(legendIsEmpty(scheduleLegend([], { quiet: true }))).toBe(false);
  });

  it("liste les lieux de mes blocs une seule fois, dans l'ordre, maison comprise", () => {
    const l = scheduleLegend(
      [
        { source: "manual", placeId: "cegep" },
        { source: "ics", placeId: null },
        { source: "manual", placeId: "cegep" },
        { source: "image", placeId: "job" },
      ],
      { quiet: false },
    );
    expect(l.places).toEqual(["cegep", null, "job"]);
    expect(l.kinds).toEqual([]);
  });

  it("les blocs en lecture seule donnent leur sorte, dans un ordre fixe, sans compter leur lieu", () => {
    const l = scheduleLegend(
      [
        { source: "subscription", placeId: null, subscription: { countsAsBusy: false } },
        { source: "outlook", placeId: null },
        { source: "meetup", placeId: "cafe" },
        { source: "subscription", placeId: null, subscription: { countsAsBusy: true } },
        { source: "study", placeId: "cegep" },
      ],
      { quiet: true },
    );
    expect(l.kinds).toEqual(["plan", "etude", "outlook", "abonnement", "abonnement-libre"]);
    expect(l.places).toEqual([]);
    expect(l.quiet).toBe(true);
  });

  it("un abonnement sans réglage connu compte comme occupé", () => {
    expect(
      scheduleLegend([{ source: "subscription", placeId: null }], { quiet: false }).kinds,
    ).toEqual(["abonnement"]);
  });

  it("garde l'information des séances d'étude proposées", () => {
    const l = scheduleLegend([], { quiet: false, proposedStudy: true });
    expect(l.proposedStudy).toBe(true);
    expect(legendIsEmpty(l)).toBe(false);
  });
});
