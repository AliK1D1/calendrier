import { describe, expect, it } from "vitest";

import { nextOccurrence, recursOn } from "../recurrence";

describe("nextOccurrence (story 5)", () => {
  it("avant l'ancrage : l'ancrage", () => {
    expect(nextOccurrence({ unit: "day", every: 2, anchor: "2027-03-16" }, "2027-03-01")).toBe(
      "2027-03-16",
    );
  });

  it("tous les 2 jours : le jour même s'il tombe, sinon le lendemain", () => {
    const rule = { unit: "day" as const, every: 2, anchor: "2027-03-16" };
    expect(nextOccurrence(rule, "2027-03-18")).toBe("2027-03-18");
    expect(nextOccurrence(rule, "2027-03-19")).toBe("2027-03-20");
  });

  it("toutes les 2 semaines : même jour de semaine que l'ancrage, une semaine sur deux", () => {
    // 2027-03-16 est un mardi.
    const rule = { unit: "week" as const, every: 2, anchor: "2027-03-16" };
    expect(nextOccurrence(rule, "2027-03-17")).toBe("2027-03-30");
    expect(nextOccurrence(rule, "2027-03-30")).toBe("2027-03-30");
  });

  it("chaque mois le 31 : le dernier jour des mois courts, sans glisser", () => {
    const rule = { unit: "month" as const, every: 1, anchor: "2027-01-31" };
    expect(nextOccurrence(rule, "2027-02-01")).toBe("2027-02-28");
    expect(nextOccurrence(rule, "2027-03-01")).toBe("2027-03-31");
    expect(nextOccurrence(rule, "2027-04-01")).toBe("2027-04-30");
  });

  it("tous les 3 mois et chaque année", () => {
    expect(nextOccurrence({ unit: "month", every: 3, anchor: "2027-01-15" }, "2027-01-16")).toBe(
      "2027-04-15",
    );
    expect(nextOccurrence({ unit: "year", every: 1, anchor: "2028-02-29" }, "2028-03-01")).toBe(
      "2029-02-28",
    );
  });

  it("au-delà de la fin : null", () => {
    const rule = { unit: "day" as const, every: 7, anchor: "2027-03-16" };
    expect(nextOccurrence(rule, "2027-03-17", "2027-03-22")).toBeNull();
    expect(nextOccurrence(rule, "2027-03-17", "2027-03-23")).toBe("2027-03-23");
  });

  it("est toujours une occurrence (comparé à recursOn sur deux ans)", () => {
    const rules = [
      { unit: "day" as const, every: 3, anchor: "2027-03-16" },
      { unit: "week" as const, every: 3, anchor: "2027-03-18" },
      { unit: "month" as const, every: 2, anchor: "2027-01-30" },
      { unit: "year" as const, every: 1, anchor: "2027-07-04" },
    ];
    for (const rule of rules) {
      for (let i = 0; i < 730; i += 11) {
        const from = new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10);
        const next = nextOccurrence(rule, from);
        expect(next).not.toBeNull();
        expect(next! >= from).toBe(true);
        expect(recursOn(rule, next!)).toBe(true);
        // Aucune occurrence entre `from` et `next`.
        for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) < next!;) {
          expect(recursOn(rule, d.toISOString().slice(0, 10))).toBe(false);
          d = new Date(d.getTime() + 86_400_000);
        }
      }
    }
  });
});
