import { describe, expect, it } from "vitest";

import { isLocale, resolveLocale } from "../config";
import {
  formatClockLocale,
  formatDay,
  formatDuration,
  formatInstantClock,
  weekdayLong,
  weekdayShort,
} from "../format";
import { getMessages } from "../messages";
import { translateServerText } from "../serverText";

describe("resolveLocale", () => {
  it("garde fr et en, et retombe sur le français sinon", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("de")).toBe("fr");
    expect(resolveLocale(undefined)).toBe("fr");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("EN")).toBe(false);
  });
});

describe("formatClockLocale", () => {
  it("écrit l'heure à la québécoise en français", () => {
    expect(formatClockLocale(15 * 60 + 42, "fr")).toBe("15 h 42");
    expect(formatClockLocale(10 * 60, "fr")).toBe("10 h");
  });
  it("écrit l'heure sur 12 h en anglais", () => {
    expect(formatClockLocale(15 * 60 + 42, "en")).toBe("3:42 PM");
    expect(formatClockLocale(9 * 60 + 5, "en")).toBe("9:05 AM");
    expect(formatClockLocale(12 * 60, "en")).toBe("noon");
    expect(formatClockLocale(24 * 60, "en")).toBe("midnight");
  });
  it("lit l'heure locale de Toronto, même en heure avancée", () => {
    // 2026-07-01 19:30 UTC = 15 h 30 à Toronto (UTC−4).
    const summer = new Date("2026-07-01T19:30:00Z");
    expect(formatInstantClock(summer, "fr")).toBe("15 h 30");
    expect(formatInstantClock(summer, "en")).toBe("3:30 PM");
    // 2026-12-01 20:30 UTC = 15 h 30 à Toronto (UTC−5).
    expect(formatInstantClock(new Date("2026-12-01T20:30:00Z"), "fr")).toBe("15 h 30");
  });
});

describe("formatDay", () => {
  it("formate un jour selon la langue", () => {
    expect(formatDay("2026-09-15", "weekdayDayMonth", "fr")).toBe("mardi 15 septembre");
    expect(formatDay("2026-09-15", "weekdayDayMonth", "en")).toBe("Tuesday, September 15");
  });
  it("nomme les jours de la semaine", () => {
    expect(weekdayLong(1, "fr")).toBe("lundi");
    expect(weekdayLong(1, "en")).toBe("Monday");
    expect(weekdayShort(7, "en")).toBe("Sun");
  });
});

describe("formatDuration", () => {
  it("écrit une durée", () => {
    expect(formatDuration(90, "fr")).toBe("1 h 30");
    expect(formatDuration(90, "en")).toBe("1 h 30 min");
    expect(formatDuration(45, "en")).toBe("45 min");
    expect(formatDuration(120, "fr")).toBe("2 h");
  });
});

describe("dictionnaires", () => {
  it("ont les mêmes clés en français et en anglais", () => {
    const keys = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v !== null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(keys(getMessages("en")).sort()).toEqual(keys(getMessages("fr")).sort());
  });
});

describe("translateServerText", () => {
  it("laisse le français tel quel", () => {
    expect(translateServerText("Groupe introuvable.", "fr")).toBe("Groupe introuvable.");
  });
  it("traduit un message fixe", () => {
    expect(translateServerText("Groupe introuvable.", "en")).toBe("Group not found.");
  });
  it("traduit un message avec des valeurs", () => {
    expect(translateServerText("Le titre est trop long (80 caractères au maximum).", "en")).toBe(
      "The title is too long (80 characters maximum).",
    );
    expect(translateServerText("Il te manque 1 h 30 avant l'examen de chimie.", "en")).toBe(
      "You're missing 1 h 30 min before the exam for chimie.",
    );
    expect(translateServerText("2 séances ajoutées à ton horaire.", "en")).toBe(
      "2 sessions added to your schedule.",
    );
  });
  it("traduit un message composé morceau par morceau", () => {
    expect(translateServerText("Séance non déplacée : Séance introuvable.", "en")).toBe(
      "Session not moved: Session not found.",
    );
  });
  it("laisse en français un message inconnu (jamais de texte vide)", () => {
    expect(translateServerText("Message inconnu.", "en")).toBe("Message inconnu.");
  });
});
