import { describe, expect, it } from "vitest";

import { getFreeWindows } from "../freeWindows";
import {
  NO_QUIET_HOURS,
  quietHoursBlocks,
  quietHoursFromDb,
  quietHoursToDb,
  validateQuietHours,
} from "../quietHours";
import { minutesBetween } from "../time";

const iso = (d: Date) => d.toISOString();

describe("validateQuietHours", () => {
  it("accepte des limites, une seule, ou aucune", () => {
    expect(validateQuietHours({ before: "09:00", after: "22:00" })).toEqual({
      ok: true,
      value: { before: 540, after: 1320 },
    });
    expect(validateQuietHours({ before: "", after: "21:30" })).toEqual({
      ok: true,
      value: { before: null, after: 1290 },
    });
    expect(validateQuietHours({})).toEqual({ ok: true, value: NO_QUIET_HOURS });
  });

  it.each([
    [{ before: "22:00", after: "09:00" }, /après/],
    [{ before: "10:00", after: "10:00" }, /après/],
    [{ before: "00:00" }, /invalide/],
    [{ after: "24:00" }, /invalide/],
    [{ before: "9h" }, /invalide/],
    [{ before: 540 }, /invalide/],
  ])("refuse %o", (raw, erreur) => {
    const r = validateQuietHours(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(erreur);
  });

  it("aller-retour avec la BD", () => {
    expect(quietHoursToDb({ before: 540, after: null })).toEqual({
      unavailable_before: "09:00",
      unavailable_after: null,
    });
    expect(quietHoursFromDb("09:00:00", "22:00:00")).toEqual({ before: 540, after: 1320 });
    expect(quietHoursFromDb(null, null)).toEqual(NO_QUIET_HOURS);
    // Valeurs incohérentes (ne devrait pas arriver, contrainte en BD) : aucune limite.
    expect(quietHoursFromDb("22:00:00", "09:00:00")).toEqual(NO_QUIET_HOURS);
  });
});

describe("quietHoursBlocks", () => {
  const q = { before: 9 * 60, after: 22 * 60 };

  it("deux blocs par jour à la maison, en heure locale (HAE : UTC−4)", () => {
    const blocks = quietHoursBlocks(q, { from: "2025-09-15", to: "2025-09-16" }, "maison");
    expect(blocks.map((b) => [b.id, iso(b.start), iso(b.end), b.placeId])).toEqual([
      ["calme-avant@2025-09-15", "2025-09-15T04:00:00.000Z", "2025-09-15T13:00:00.000Z", "maison"],
      ["calme-apres@2025-09-15", "2025-09-16T02:00:00.000Z", "2025-09-16T04:00:00.000Z", "maison"],
      ["calme-avant@2025-09-16", "2025-09-16T04:00:00.000Z", "2025-09-16T13:00:00.000Z", "maison"],
      ["calme-apres@2025-09-16", "2025-09-17T02:00:00.000Z", "2025-09-17T04:00:00.000Z", "maison"],
    ]);
  });

  it("jour du retour à l'heure normale (2 nov. 2025) : « avant 9 h » dure 10 h, 22 h reste 22 h HNE", () => {
    const [avant, apres] = quietHoursBlocks(q, { from: "2025-11-02", to: "2025-11-02" }, "m");
    expect(minutesBetween(avant.start, avant.end)).toBe(10 * 60);
    expect(iso(avant.end)).toBe("2025-11-02T14:00:00.000Z"); // 9 h HNE
    expect(iso(apres.start)).toBe("2025-11-03T03:00:00.000Z"); // 22 h HNE
  });

  it("jour du passage à l'heure avancée (9 mars 2025) : « avant 9 h » dure 8 h", () => {
    const [avant] = quietHoursBlocks(
      { before: 9 * 60, after: null },
      { from: "2025-03-09", to: "2025-03-09" },
      "m",
    );
    expect(minutesBetween(avant.start, avant.end)).toBe(8 * 60);
    expect(iso(avant.end)).toBe("2025-03-09T13:00:00.000Z"); // 9 h HAE
  });

  it("aucune limite : aucun bloc", () => {
    expect(quietHoursBlocks(NO_QUIET_HOURS, { from: "2025-09-15", to: "2025-09-21" }, "m")).toEqual(
      [],
    );
  });

  it("traitées comme occupées par getFreeWindows : la journée libre va de 9 h à 22 h", () => {
    const range = { from: "2025-09-15", to: "2025-09-15" };
    const windows = getFreeWindows(
      {
        id: "ali",
        name: "Ali",
        homePlaceId: "maison",
        travelMode: "walk",
        places: [{ id: "maison", name: "Maison", lat: 45.5, lng: -73.5 }],
        busyBlocks: quietHoursBlocks(q, range, "maison"),
      },
      new Date("2025-09-15T04:00:00.000Z"),
      new Date("2025-09-16T04:00:00.000Z"),
    );
    expect(windows.map((w) => [iso(w.start), iso(w.end), w.placeBeforeId, w.placeAfterId])).toEqual(
      [["2025-09-15T13:00:00.000Z", "2025-09-16T02:00:00.000Z", "maison", "maison"]],
    );
  });
});
