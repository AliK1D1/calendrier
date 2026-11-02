import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import { daySegments, getFreeWindows, mergeBusyBlocks } from "../freeWindows";
import { TIME_ZONE, minutesBetween, zonedDayBounds, zonedTime } from "../time";
import type { BusyBlock, FreeWindow, Person } from "../types";
import { PLACES, WEEK, ali, at } from "./fixtures";

const HOME = "maison";
const CEGEP = "cegep";
const TRAVAIL = "travail";
const D = "2025-09-16"; // un mardi ordinaire (HAE)

function t(time: string, day: string = D): Date {
  return zonedTime(day, time);
}

function b(start: string, end: string, placeId: string, day: string = D): BusyBlock {
  return {
    id: `${placeId}-${start}`,
    start: t(start, day),
    end: t(end, day),
    placeId,
    title: placeId,
  };
}

function person(busyBlocks: BusyBlock[]): Person {
  return {
    id: "p",
    name: "P",
    homePlaceId: HOME,
    travelMode: "transit",
    busyBlocks,
    places: [],
  };
}

/** Représentation lisible : « HH:mm-HH:mm avant>après » en heure locale. */
function show(windows: FreeWindow[], day: string = D): string[] {
  const fmt = (d: Date) => {
    const sameDay = formatInTimeZone(d, TIME_ZONE, "yyyy-MM-dd") === day;
    return (sameDay ? "" : "+1 ") + formatInTimeZone(d, TIME_ZONE, "HH:mm");
  };
  return windows.map((w) => `${fmt(w.start)}-${fmt(w.end)} ${w.placeBeforeId}>${w.placeAfterId}`);
}

describe("getFreeWindows", () => {
  it("journée vide : une seule fenêtre, de la maison à la maison", () => {
    const { start, end } = zonedDayBounds(D);
    const w = getFreeWindows(person([]), start, end);
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({ start, end, placeBeforeId: HOME, placeAfterId: HOME });
  });

  it("journée vide avec heures 8 h → 22 h", () => {
    const { start, end } = zonedDayBounds(D);
    const w = getFreeWindows(person([]), start, end, {
      dayHours: { start: "08:00", end: "22:00" },
    });
    expect(show(w)).toEqual(["08:00-22:00 maison>maison"]);
  });

  it("trou entre deux blocs : lieu avant et après, maison en début et fin de journée", () => {
    const p = person([b("09:00", "10:00", CEGEP), b("11:00", "12:00", TRAVAIL)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual([
      "08:00-09:00 maison>cegep",
      "10:00-11:00 cegep>travail",
      "12:00-22:00 travail>maison",
    ]);
  });

  it("trie les blocs donnés dans le désordre", () => {
    const p = person([b("11:00", "12:00", TRAVAIL), b("09:00", "10:00", CEGEP)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)[1]).toBe("10:00-11:00 cegep>travail");
  });

  it("blocs collés : aucune fenêtre de durée nulle entre eux", () => {
    const p = person([b("09:00", "10:00", CEGEP), b("10:00", "11:00", TRAVAIL)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["08:00-09:00 maison>cegep", "11:00-22:00 travail>maison"]);
  });

  it("blocs qui se chevauchent : fusionnés, on repart du lieu du bloc qui finit le plus tard", () => {
    const p = person([b("09:00", "11:00", CEGEP), b("10:00", "12:00", TRAVAIL)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["08:00-09:00 maison>cegep", "12:00-22:00 travail>maison"]);
  });

  it("bloc contenu dans un autre : le lieu du grand bloc est gardé", () => {
    const p = person([b("09:00", "13:00", CEGEP), b("10:00", "11:00", TRAVAIL)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["08:00-09:00 maison>cegep", "13:00-22:00 cegep>maison"]);
  });

  it("chevauchement de trois blocs en chaîne", () => {
    const p = person([
      b("09:00", "10:30", CEGEP),
      b("10:00", "11:30", CEGEP),
      b("11:15", "12:00", TRAVAIL),
      b("14:00", "15:00", CEGEP),
    ]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual([
      "08:00-09:00 maison>cegep",
      "12:00-14:00 travail>cegep",
      "15:00-22:00 cegep>maison",
    ]);
  });

  it("bloc qui déborde au début de la journée : la journée commence à sa fin, à son lieu", () => {
    const p = person([b("06:00", "09:00", CEGEP)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["09:00-22:00 cegep>maison"]);
  });

  it("bloc qui déborde à la fin de la journée : la dernière fenêtre se termine à son début", () => {
    const p = person([b("21:00", "23:30", TRAVAIL)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["08:00-21:00 maison>travail"]);
  });

  it("bloc qui couvre toute la journée : aucune fenêtre", () => {
    const p = person([b("07:00", "23:00", TRAVAIL)]);
    expect(getFreeWindows(p, t("08:00"), t("22:00"))).toEqual([]);
  });

  it("blocs entièrement hors de la journée : ignorés", () => {
    const veille = "2025-09-15";
    const p = person([b("09:00", "17:00", TRAVAIL, veille), b("06:00", "07:30", CEGEP)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"));
    expect(show(w)).toEqual(["08:00-22:00 maison>maison"]);
  });

  it("bloc de durée nulle ou inversé : ignoré", () => {
    const p = person([b("10:00", "10:00", CEGEP), b("12:00", "11:00", CEGEP)]);
    expect(show(getFreeWindows(p, t("08:00"), t("22:00")))).toEqual(["08:00-22:00 maison>maison"]);
  });

  it("dayHours : les heures hors de la plage comptent comme occupées", () => {
    const p = person([b("07:00", "09:00", CEGEP), b("21:00", "23:00", TRAVAIL)]);
    const { start, end } = zonedDayBounds(D);
    const w = getFreeWindows(p, start, end, { dayHours: { start: "08:00", end: "22:00" } });
    expect(show(w)).toEqual(["09:00-21:00 cegep>travail"]);
  });

  it("dayHours sur plusieurs jours : une série de fenêtres par jour", () => {
    const p = person([b("10:00", "12:00", CEGEP, "2025-09-16")]);
    const w = getFreeWindows(
      p,
      zonedDayBounds("2025-09-15").start,
      zonedDayBounds("2025-09-16").end,
      {
        dayHours: { start: "08:00", end: "22:00" },
      },
    );
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ start: t("08:00", "2025-09-15"), end: t("22:00", "2025-09-15") });
    expect(w[1]).toMatchObject({ start: t("08:00"), end: t("10:00"), placeAfterId: CEGEP });
    expect(w[2]).toMatchObject({ start: t("12:00"), end: t("22:00"), placeBeforeId: CEGEP });
  });

  it("dayHours jusqu'à minuit (« 24:00 »)", () => {
    const { start, end } = zonedDayBounds(D);
    const w = getFreeWindows(person([]), start, end, {
      dayHours: { start: "00:00", end: "24:00" },
    });
    expect(w).toEqual([{ start, end, placeBeforeId: HOME, placeAfterId: HOME }]);
  });

  it("bloc de nuit qui traverse minuit : il occupe la fin d'un jour et le début du suivant", () => {
    const veille = "2025-09-15";
    const nuit: BusyBlock = {
      id: "nuit",
      start: t("20:00", veille),
      end: t("02:00", D),
      placeId: TRAVAIL,
      title: "Quart de nuit",
    };
    const w = getFreeWindows(person([nuit]), zonedDayBounds(veille).start, zonedDayBounds(D).end);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ end: t("20:00", veille), placeAfterId: TRAVAIL });
    expect(w[1]).toMatchObject({ start: t("02:00"), placeBeforeId: TRAVAIL, placeAfterId: HOME });
  });

  it("mergeGapMinutes : les petits trous sont fusionnés", () => {
    const p = person([b("09:00", "10:00", CEGEP), b("10:10", "11:00", CEGEP)]);
    expect(getFreeWindows(p, t("08:00"), t("22:00"))).toHaveLength(3);
    const w = getFreeWindows(p, t("08:00"), t("22:00"), { mergeGapMinutes: 15 });
    expect(show(w)).toEqual(["08:00-09:00 maison>cegep", "11:00-22:00 cegep>maison"]);
  });

  it("extraBusyBlocks : comptés comme occupés", () => {
    const p = person([b("09:00", "10:00", CEGEP)]);
    const w = getFreeWindows(p, t("08:00"), t("22:00"), {
      extraBusyBlocks: [b("18:00", "20:00", "resto")],
    });
    expect(show(w)).toEqual([
      "08:00-09:00 maison>cegep",
      "10:00-18:00 cegep>resto",
      "20:00-22:00 resto>maison",
    ]);
  });

  it("ne modifie pas les blocs de la personne", () => {
    const blocks = [b("11:00", "12:00", TRAVAIL), b("09:00", "11:30", CEGEP)];
    const copy = blocks.map((x) => ({ ...x }));
    getFreeWindows(person(blocks), t("08:00"), t("22:00"));
    expect(blocks).toEqual(copy);
  });

  describe("changement d'heure", () => {
    it("novembre (2 nov. 2025) : la journée vide dure 25 h", () => {
      const day = "2025-11-02";
      const { start, end } = zonedDayBounds(day);
      const [w] = getFreeWindows(person([]), start, end);
      expect(minutesBetween(w.start, w.end)).toBe(25 * 60);
    });

    it("novembre : 8 h → 22 h reste 14 h, aux bons instants UTC (HNE)", () => {
      const day = "2025-11-02";
      const { start, end } = zonedDayBounds(day);
      const [w] = getFreeWindows(person([]), start, end, {
        dayHours: { start: "08:00", end: "22:00" },
      });
      expect(w.start.toISOString()).toBe("2025-11-02T13:00:00.000Z");
      expect(w.end.toISOString()).toBe("2025-11-03T03:00:00.000Z");
      expect(minutesBetween(w.start, w.end)).toBe(14 * 60);
    });

    it("novembre : un bloc de 00:30 à 03:00 dure 3 h 30 réelles ; la fenêtre suivante commence à 03:00 HNE", () => {
      const day = "2025-11-02";
      const p = person([b("00:30", "03:00", TRAVAIL, day)]);
      const { start, end } = zonedDayBounds(day);
      const w = getFreeWindows(p, start, end);
      expect(minutesBetween(p.busyBlocks[0].start, p.busyBlocks[0].end)).toBe(210);
      expect(w).toHaveLength(2);
      expect(minutesBetween(w[0].start, w[0].end)).toBe(30);
      expect(w[1].start.toISOString()).toBe("2025-11-02T08:00:00.000Z");
      expect(w[1].placeBeforeId).toBe(TRAVAIL);
    });

    it("mars (9 mars 2025) : la journée vide dure 23 h", () => {
      const day = "2025-03-09";
      const { start, end } = zonedDayBounds(day);
      const [w] = getFreeWindows(person([]), start, end);
      expect(minutesBetween(w.start, w.end)).toBe(23 * 60);
    });

    it("mars : un trou de 01:00 à 04:00 (heure locale) ne dure que 2 h", () => {
      const day = "2025-03-09";
      const p = person([b("00:00", "01:00", TRAVAIL, day), b("04:00", "05:00", CEGEP, day)]);
      const { start, end } = zonedDayBounds(day);
      const w = getFreeWindows(p, start, end);
      expect(w[0]).toMatchObject({ placeBeforeId: TRAVAIL, placeAfterId: CEGEP });
      expect(minutesBetween(w[0].start, w[0].end)).toBe(120);
      expect(w[1].start.toISOString()).toBe("2025-03-09T09:00:00.000Z"); // 05:00 HAE
    });

    it("mars : 8 h → 22 h reste 14 h, aux bons instants UTC (HAE)", () => {
      const day = "2025-03-09";
      const { start, end } = zonedDayBounds(day);
      const [w] = getFreeWindows(person([]), start, end, {
        dayHours: { start: "08:00", end: "22:00" },
      });
      expect(w.start.toISOString()).toBe("2025-03-09T12:00:00.000Z");
      expect(minutesBetween(w.start, w.end)).toBe(14 * 60);
    });
  });

  it("fixtures : ali a une pause de 1 h au cégep le lundi de 10 h à 11 h", () => {
    const { start, end } = zonedDayBounds(WEEK.lun);
    const w = getFreeWindows(ali, start, end, { dayHours: { start: "08:00", end: "22:00" } });
    expect(w).toContainEqual({
      start: at("lun", "10:00"),
      end: at("lun", "11:00"),
      placeBeforeId: PLACES.cegepEM.id,
      placeAfterId: PLACES.cegepEM.id,
    });
    expect(w.at(-1)).toMatchObject({
      start: at("lun", "16:00"),
      end: at("lun", "22:00"),
      placeAfterId: ali.homePlaceId,
    });
  });
});

describe("mergeBusyBlocks", () => {
  it("garde le lieu de départ du premier bloc et le lieu de fin du dernier", () => {
    const m = mergeBusyBlocks([b("09:00", "11:00", CEGEP), b("10:00", "12:00", TRAVAIL)]);
    expect(m).toEqual([
      { start: t("09:00"), end: t("12:00"), startPlaceId: CEGEP, endPlaceId: TRAVAIL },
    ]);
  });
});

describe("daySegments", () => {
  it("plage vide ou inversée : aucun segment", () => {
    expect(daySegments(t("10:00"), t("10:00"), undefined)).toEqual([]);
    expect(daySegments(t("10:00"), t("09:00"), { start: "08:00", end: "22:00" })).toEqual([]);
  });

  it("coupe la plage aux heures de la journée", () => {
    expect(daySegments(t("09:00"), t("23:00"), { start: "08:00", end: "22:00" })).toEqual([
      { start: t("09:00"), end: t("22:00") },
    ]);
  });
});
