import { describe, expect, it } from "vitest";

import { ceilToMinutes, localDay, periodRange } from "../period";

describe("periodRange", () => {
  it("cette semaine : d'aujourd'hui au dimanche", () => {
    expect(periodRange("this-week", "2025-09-17")).toEqual({
      from: "2025-09-17",
      to: "2025-09-21",
    });
    expect(periodRange("this-week", "2025-09-15")).toEqual({
      from: "2025-09-15",
      to: "2025-09-21",
    });
    // Dimanche : seulement aujourd'hui.
    expect(periodRange("this-week", "2025-09-21")).toEqual({
      from: "2025-09-21",
      to: "2025-09-21",
    });
  });

  it("la semaine prochaine : lundi au dimanche suivants, même en fin de mois ou d'année", () => {
    expect(periodRange("next-week", "2025-09-17")).toEqual({
      from: "2025-09-22",
      to: "2025-09-28",
    });
    expect(periodRange("next-week", "2025-09-21")).toEqual({
      from: "2025-09-22",
      to: "2025-09-28",
    });
    expect(periodRange("next-week", "2026-12-30")).toEqual({
      from: "2027-01-04",
      to: "2027-01-10",
    });
  });
});

describe("localDay / ceilToMinutes", () => {
  it("jour local à Montréal, pas UTC", () => {
    // 2 h UTC le 16 = 22 h HAE le 15.
    expect(localDay(new Date("2025-09-16T02:00:00Z"))).toBe("2025-09-15");
  });

  it("arrondit au quart d'heure suivant", () => {
    expect(ceilToMinutes(new Date("2025-09-15T14:07:30Z")).toISOString()).toBe(
      "2025-09-15T14:15:00.000Z",
    );
    expect(ceilToMinutes(new Date("2025-09-15T14:15:00Z")).toISOString()).toBe(
      "2025-09-15T14:15:00.000Z",
    );
  });
});
