import { describe, expect, it } from "vitest";

import { toPeople } from "@/lib/db/convert";

import {
  daysAtOutingLimit,
  outingCountRange,
  outingLimitBlocks,
  outingLimitsFromDb,
  validateOutingLimits,
} from "../outingLimits";
import { zonedTime } from "../time";

const outing = (day: string, time = "18:00") => ({ start: zonedTime(day, time) });
// Semaine du lundi 9 au dimanche 15 novembre 2026.
const week = { from: "2026-11-09", to: "2026-11-15" };

describe("daysAtOutingLimit", () => {
  it("sans limite ou sans sortie : aucun jour", () => {
    expect(
      daysAtOutingLimit([outing("2026-11-12")], { perDay: null, perWeek: null }, week),
    ).toEqual([]);
    expect(daysAtOutingLimit([], { perDay: 1, perWeek: 1 }, week)).toEqual([]);
  });

  it("limite par jour : seulement les jours qui l'ont atteinte", () => {
    const outings = [outing("2026-11-12"), outing("2026-11-14", "12:00"), outing("2026-11-14")];
    expect(daysAtOutingLimit(outings, { perDay: 1, perWeek: null }, week)).toEqual([
      "2026-11-12",
      "2026-11-14",
    ]);
    expect(daysAtOutingLimit(outings, { perDay: 2, perWeek: null }, week)).toEqual(["2026-11-14"]);
  });

  it("limite par semaine : toute la semaine (lundi → dimanche), pas la suivante", () => {
    const outings = [outing("2026-11-10"), outing("2026-11-12")];
    const range = { from: "2026-11-13", to: "2026-11-17" };
    expect(daysAtOutingLimit(outings, { perDay: null, perWeek: 2 }, range)).toEqual([
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(daysAtOutingLimit(outings, { perDay: null, perWeek: 3 }, range)).toEqual([]);
  });

  it("une sortie compte le jour local où elle commence (23 h 30 reste ce jour-là)", () => {
    expect(
      daysAtOutingLimit([outing("2026-11-12", "23:30")], { perDay: 1, perWeek: null }, week),
    ).toEqual(["2026-11-12"]);
  });
});

describe("outingLimitBlocks", () => {
  it("un bloc de minuit à minuit à la maison, 25 h le jour du retour à l'heure normale", () => {
    const [b] = outingLimitBlocks(
      [outing("2026-11-01")],
      { perDay: 1, perWeek: null },
      { from: "2026-11-01", to: "2026-11-01" },
      "maison",
    );
    expect(b.id).toBe("limite-sorties@2026-11-01");
    expect(b.placeId).toBe("maison");
    expect((b.end.getTime() - b.start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("outingCountRange", () => {
  it("s'étend aux semaines complètes", () => {
    expect(outingCountRange({ from: "2026-11-12", to: "2026-11-17" })).toEqual({
      from: "2026-11-09",
      to: "2026-11-22",
    });
  });
});

describe("validation et lecture BD", () => {
  it("accepte vide, nombres et chiffres en texte ; refuse hors bornes", () => {
    expect(validateOutingLimits({ perDay: "", perWeek: null })).toEqual({
      ok: true,
      value: { perDay: null, perWeek: null },
    });
    expect(validateOutingLimits({ perDay: "1", perWeek: 3 })).toEqual({
      ok: true,
      value: { perDay: 1, perWeek: 3 },
    });
    expect(validateOutingLimits({ perDay: 6, perWeek: 3 }).ok).toBe(false);
    expect(validateOutingLimits({ perDay: 1, perWeek: 0 }).ok).toBe(false);
    expect(validateOutingLimits({ perDay: "1.5" }).ok).toBe(false);
    expect(validateOutingLimits(null).ok).toBe(false);
  });

  it("valeur absente (avant la migration 0022) ou invalide : pas de limite", () => {
    expect(outingLimitsFromDb(undefined, undefined)).toEqual({ perDay: null, perWeek: null });
    expect(outingLimitsFromDb(9, 2)).toEqual({ perDay: null, perWeek: 2 });
  });
});

describe("toPeople avec une limite de sorties", () => {
  const profile = {
    id: "ali",
    display_name: "Ali",
    travel_mode: "walk" as const,
    home_place_id: "maison",
  };
  const places = [{ id: "maison", owner_id: "ali", name: "Maison", lat: 45.5, lng: -73.5 }];
  const row = (id: string, day: string, extra: object) => ({
    id,
    owner_id: "ali",
    title: id,
    place_id: null,
    start_time: "18:00:00",
    end_time: "20:00:00",
    weekday: null,
    valid_from: day,
    valid_until: null,
    ...extra,
  });
  const blocks = [
    row("souper", "2026-11-12", { is_outing: true }),
    row("cinema", "2026-11-10", { source: "meetup" }),
    row("dentiste", "2026-11-13", { source: "manual" }),
  ];
  const limitDays = (p: object, range = week) =>
    toPeople([{ ...profile, ...p }], places, blocks, range)
      .people[0].busyBlocks.filter((b) => b.id.startsWith("limite-sorties@"))
      .map((b) => b.id.slice("limite-sorties@".length));

  it("sans limite : rien de plus", () => {
    expect(limitDays({})).toEqual([]);
  });

  it("1 par jour : les jours de sortie sont pris en entier ; un rendez-vous n'est pas une sortie", () => {
    expect(limitDays({ max_outings_per_day: 1 })).toEqual(["2026-11-10", "2026-11-12"]);
  });

  it("2 par semaine : compte aussi les sorties de la semaine hors de la plage demandée", () => {
    expect(
      limitDays({ max_outings_per_week: 2 }, { from: "2026-11-14", to: "2026-11-16" }),
    ).toEqual(["2026-11-14", "2026-11-15"]);
  });
});
