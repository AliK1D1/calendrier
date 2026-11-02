import { describe, expect, it } from "vitest";

import { eachDay, minutesBetween, nextDay, zonedDayBounds, zonedTime } from "../time";

describe("time", () => {
  it("convertit une heure locale en instant (HNE et HAE)", () => {
    expect(zonedTime("2025-01-15", "12:00").toISOString()).toBe("2025-01-15T17:00:00.000Z");
    expect(zonedTime("2025-07-15", "12:00").toISOString()).toBe("2025-07-15T16:00:00.000Z");
  });

  it("« 24:00 » désigne minuit le lendemain", () => {
    expect(zonedTime("2025-12-31", "24:00").toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("une journée de changement d'heure dure 23 h (mars) ou 25 h (novembre)", () => {
    const mars = zonedDayBounds("2025-03-09");
    const nov = zonedDayBounds("2025-11-02");
    const normal = zonedDayBounds("2025-11-03");
    expect(minutesBetween(mars.start, mars.end)).toBe(23 * 60);
    expect(minutesBetween(nov.start, nov.end)).toBe(25 * 60);
    expect(minutesBetween(normal.start, normal.end)).toBe(24 * 60);
  });

  it("heure qui n'existe pas (saut de mars) : décalée vers l'avant, jamais en arrière", () => {
    // 2026-03-08 : 2 h HNE → 3 h HAE. 2 h 30 n'existe pas : 3 h 30 HAE (07:30 UTC).
    expect(zonedTime("2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedTime("2026-03-08", "02:00").toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(zonedTime("2026-03-08", "01:59").toISOString()).toBe("2026-03-08T06:59:00.000Z");
    expect(zonedTime("2026-03-08", "03:00").toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(zonedTime("2026-03-08", "02:30") > zonedTime("2026-03-08", "01:59")).toBe(true);
  });

  it("heure qui existe deux fois (novembre) : la première (heure avancée)", () => {
    // 2026-11-01 : 2 h HAE → 1 h HNE. 1 h 30 existe deux fois ; on prend 1 h 30 HAE.
    expect(zonedTime("2026-11-01", "01:30").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedTime("2026-11-01", "02:00").toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("énumère les jours d'une plage, en changeant de mois et d'année", () => {
    expect(nextDay("2025-02-28")).toBe("2025-03-01");
    expect(eachDay("2025-12-30", "2026-01-02")).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
    expect(eachDay("2025-11-01", "2025-11-03")).toHaveLength(3);
    expect(eachDay("2025-11-03", "2025-11-01")).toEqual([]);
  });

  it("refuse les formats invalides", () => {
    expect(() => zonedTime("2025-9-1", "08:00")).toThrow();
    expect(() => zonedTime("2025-09-01", "8h")).toThrow();
    expect(() => zonedTime("2025-09-01", "24:30")).toThrow();
  });

  it("refuse les jours qui n'existent pas au calendrier (au lieu de s'arrêter en silence)", () => {
    expect(() => zonedTime("2025-02-30", "08:00")).toThrow(/Jour invalide/);
    expect(() => zonedTime("2025-13-01", "08:00")).toThrow(/Jour invalide/);
    expect(() => zonedTime("2025-04-31", "08:00")).toThrow(/Jour invalide/);
    expect(() => eachDay("2025-02-28", "2025-02-30")).toThrow(/Jour invalide/);
    expect(() => nextDay("2025-00-10")).toThrow(/Jour invalide/);
    // Les vrais jours limites restent acceptés.
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
    expect(() => zonedTime("2025-02-29", "08:00")).toThrow(/Jour invalide/);
    expect(eachDay("2025-12-31", "2025-12-31")).toEqual(["2025-12-31"]);
  });
});
