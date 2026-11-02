import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import { TIME_ZONE } from "../time";
import { PEOPLE, PLACES, WEEK, at } from "./fixtures";

describe("fixtures", () => {
  it("place les instants dans le fuseau America/Toronto (heure avancée en septembre)", () => {
    // 08:00 HAE = 12:00 UTC
    expect(at("lun", "08:00").toISOString()).toBe("2025-09-15T12:00:00.000Z");
    expect(formatInTimeZone(at("ven", "17:30"), TIME_ZONE, "yyyy-MM-dd HH:mm")).toBe(
      "2025-09-19 17:30",
    );
  });

  it("a des coordonnées dans la grande région de Montréal", () => {
    for (const place of Object.values(PLACES)) {
      expect(place.lat).toBeGreaterThan(45.3);
      expect(place.lat).toBeLessThan(45.8);
      expect(place.lng).toBeGreaterThan(-74.0);
      expect(place.lng).toBeLessThan(-73.3);
    }
  });

  it.each(PEOPLE.map((p) => [p.name, p] as const))(
    "%s a un horaire cohérent avec ses lieux",
    (_name, person) => {
      const placeIds = new Set(person.places.map((p) => p.id));
      expect(placeIds.has(person.homePlaceId)).toBe(true);
      expect(person.busyBlocks.length).toBeGreaterThan(0);
      for (const b of person.busyBlocks) {
        expect(b.end.getTime()).toBeGreaterThan(b.start.getTime());
        expect(placeIds.has(b.placeId)).toBe(true);
        const day = formatInTimeZone(b.start, TIME_ZONE, "yyyy-MM-dd");
        expect(day >= WEEK.lun && day <= WEEK.dim).toBe(true);
        // Horaires plausibles : entre 7 h et 22 h.
        const startH = Number(formatInTimeZone(b.start, TIME_ZONE, "H"));
        const endH = Number(formatInTimeZone(b.end, TIME_ZONE, "H"));
        expect(startH).toBeGreaterThanOrEqual(7);
        expect(endH).toBeLessThanOrEqual(22);
      }
    },
  );

  it("ali et Sam partagent le même lieu de cégep", () => {
    const [ali, sam] = PEOPLE;
    expect(ali.places.map((p) => p.id)).toContain(PLACES.cegepEM.id);
    expect(sam.places.map((p) => p.id)).toContain(PLACES.cegepEM.id);
  });
});
