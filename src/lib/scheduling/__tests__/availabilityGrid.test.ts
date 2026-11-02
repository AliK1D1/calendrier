import { describe, expect, it } from "vitest";

import { availabilityGrid } from "../availabilityGrid";
import { WEEK, ali, at, sam } from "./fixtures";

describe("availabilityGrid", () => {
  it("tranches de 30 min de 8 h à 22 h, avec qui est libre", () => {
    const [lundi] = availabilityGrid([ali, sam], { from: WEEK.lun, to: WEEK.lun });
    expect(lundi.day).toBe(WEEK.lun);
    expect(lundi.slots).toHaveLength(28);
    const slot = (t: string) =>
      lundi.slots.find((s) => s.start.getTime() === at("lun", t).getTime());
    // 10 h : ali en pause, Sam en cours.
    expect(slot("10:00")?.freeIds).toEqual(["ali"]);
    // 13 h : ali libre (13 h → 14 h), Sam en cours.
    expect(slot("13:00")?.freeIds).toEqual(["ali"]);
    // 16 h : tous les deux libres.
    expect(slot("16:00")?.freeIds).toEqual(["ali", "sam"]);
    // 8 h : tous les deux en cours.
    expect(slot("08:00")?.freeIds).toEqual([]);
  });

  it("une semaine entière, une journée par jour ; tranche invalide refusée", () => {
    expect(availabilityGrid([ali], { from: WEEK.lun, to: WEEK.dim })).toHaveLength(7);
    expect(() =>
      availabilityGrid([ali], { from: WEEK.lun, to: WEEK.lun }, { stepMinutes: 0 }),
    ).toThrow();
  });
});
