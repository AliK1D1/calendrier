import { describe, expect, it } from "vitest";

import {
  daysInMonth,
  describeEvery,
  describeRepeat,
  isValidEvery,
  nthOccurrence,
  recursOn,
  REPEAT_EVERY_MAX,
} from "../recurrence";

/** Jours d'une plage (incluse) où la règle tombe. */
function hits(rule: Parameters<typeof recursOn>[0], from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (;;) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) return out;
    if (recursOn(rule, day)) out.push(day);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

describe("recursOn : tous les X jours", () => {
  it("tous les 3 jours à partir de l'ancrage, jamais avant", () => {
    expect(
      hits({ unit: "day", every: 3, anchor: "2026-11-05" }, "2026-11-01", "2026-11-15"),
    ).toEqual(["2026-11-05", "2026-11-08", "2026-11-11", "2026-11-14"]);
  });

  it("traverse le changement d'heure (1er novembre 2026) sans décaler", () => {
    expect(
      hits({ unit: "day", every: 2, anchor: "2026-10-30" }, "2026-10-30", "2026-11-05"),
    ).toEqual(["2026-10-30", "2026-11-01", "2026-11-03", "2026-11-05"]);
  });
});

describe("recursOn : toutes les X semaines", () => {
  it("toutes les 2 semaines : la semaine de l'ancrage, puis une sur deux", () => {
    // Ancrage : jeudi 5 novembre 2026 ; le mardi 3 (même semaine, avant l'ancrage) ne compte pas.
    const rule = { unit: "week" as const, every: 2, anchor: "2026-11-05", weekday: 2 };
    expect(hits(rule, "2026-11-01", "2026-12-15")).toEqual([
      "2026-11-17",
      "2026-12-01",
      "2026-12-15",
    ]);
    const jeudi = { ...rule, weekday: 4 };
    expect(hits(jeudi, "2026-11-01", "2026-12-15")).toEqual([
      "2026-11-05",
      "2026-11-19",
      "2026-12-03",
    ]);
  });

  it("sans jour de semaine : celui de l'ancrage", () => {
    expect(
      hits({ unit: "week", every: 3, anchor: "2026-11-02" }, "2026-11-01", "2026-12-01"),
    ).toEqual(["2026-11-02", "2026-11-23"]);
  });
});

describe("recursOn : tous les X mois (mois courts)", () => {
  it("chaque mois à partir du 31 : dernier jour des mois courts, puis retour au 31", () => {
    expect(
      hits({ unit: "month", every: 1, anchor: "2026-01-31" }, "2026-01-01", "2026-06-30"),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("février bissextile : le 29", () => {
    expect(recursOn({ unit: "month", every: 1, anchor: "2027-12-31" }, "2028-02-29")).toBe(true);
    expect(recursOn({ unit: "month", every: 1, anchor: "2027-12-31" }, "2028-02-28")).toBe(false);
  });

  it("tous les 3 mois, le 15", () => {
    expect(
      hits({ unit: "month", every: 3, anchor: "2026-11-15" }, "2026-11-01", "2027-12-31"),
    ).toEqual(["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"]);
  });
});

describe("recursOn : tous les X ans", () => {
  it("un 29 février devient le 28 les années non bissextiles", () => {
    const rule = { unit: "year" as const, every: 1, anchor: "2028-02-29" };
    expect(recursOn(rule, "2029-02-28")).toBe(true);
    expect(recursOn(rule, "2032-02-29")).toBe(true);
    expect(recursOn(rule, "2032-02-28")).toBe(false);
  });

  it("tous les 2 ans", () => {
    const rule = { unit: "year" as const, every: 2, anchor: "2026-11-05" };
    expect(recursOn(rule, "2027-11-05")).toBe(false);
    expect(recursOn(rule, "2028-11-05")).toBe(true);
    expect(recursOn(rule, "2024-11-05")).toBe(false);
  });
});

describe("règles invalides", () => {
  it("refuse un intervalle hors 1..99 ou non entier", () => {
    for (const every of [0, -1, 100, 1.5, Number.NaN]) {
      expect(isValidEvery(every)).toBe(false);
      expect(() => recursOn({ unit: "day", every, anchor: "2026-11-05" }, "2026-11-05")).toThrow();
    }
    expect(isValidEvery(REPEAT_EVERY_MAX)).toBe(true);
  });
});

describe("nthOccurrence (fin « après N fois »)", () => {
  it("jours, mois (sans glisser), ans", () => {
    expect(nthOccurrence({ unit: "day", every: 3, anchor: "2026-11-05" }, 1)).toBe("2026-11-05");
    expect(nthOccurrence({ unit: "day", every: 3, anchor: "2026-11-05" }, 4)).toBe("2026-11-14");
    expect(nthOccurrence({ unit: "month", every: 1, anchor: "2026-01-31" }, 2)).toBe("2026-02-28");
    expect(nthOccurrence({ unit: "month", every: 1, anchor: "2026-01-31" }, 3)).toBe("2026-03-31");
    expect(nthOccurrence({ unit: "month", every: 6, anchor: "2026-11-30" }, 3)).toBe("2027-11-30");
    expect(nthOccurrence({ unit: "year", every: 1, anchor: "2028-02-29" }, 2)).toBe("2029-02-28");
  });

  it("semaines : les jours cochés comptent ensemble, sans ceux d'avant l'ancrage", () => {
    // Ancrage jeudi 5 nov. 2026, mar. + jeu., toutes les 2 semaines :
    // 5 nov (jeu), 17 nov (mar), 19 nov (jeu), 1er déc (mar)…
    const rule = { unit: "week" as const, every: 2, anchor: "2026-11-05" };
    expect(nthOccurrence(rule, 1, [2, 4])).toBe("2026-11-05");
    expect(nthOccurrence(rule, 2, [4, 2])).toBe("2026-11-17");
    expect(nthOccurrence(rule, 4, [2, 4])).toBe("2026-12-01");
  });

  it("refuse un nombre de fois invalide", () => {
    expect(() => nthOccurrence({ unit: "day", every: 1, anchor: "2026-11-05" }, 0)).toThrow();
  });
});

describe("textes", () => {
  it("décrit l'intervalle en français", () => {
    expect(describeEvery(1, "day")).toBe("tous les jours");
    expect(describeEvery(2, "week")).toBe("toutes les 2 semaines");
    expect(describeEvery(1, "month")).toBe("chaque mois");
    expect(describeEvery(3, "month")).toBe("tous les 3 mois");
    expect(describeEvery(1, "year")).toBe("chaque année");
    expect(describeEvery(2, "year")).toBe("tous les 2 ans");
  });

  it("précise le quantième des mois et la date des ans", () => {
    expect(describeRepeat({ unit: "month", every: 1, anchor: "2026-01-31" })).toBe(
      "chaque mois, le 31 (ou le dernier jour du mois)",
    );
    expect(describeRepeat({ unit: "month", every: 2, anchor: "2026-01-01" })).toBe(
      "tous les 2 mois, le 1er",
    );
    expect(describeRepeat({ unit: "year", every: 1, anchor: "2026-02-14" })).toBe(
      "chaque année, le 14 février",
    );
  });

  it("jours par mois", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});
