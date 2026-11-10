import { describe, expect, it } from "vitest";

import { expandBusyBlock, toBlockSpec } from "@/lib/db/convert";

import {
  MAX_SKIP_DAYS,
  restoreOccurrence,
  skipOccurrence,
  upcomingSkips,
  validateSkipDay,
} from "../skipDays";
import { type BlockSpec, blocksOnDay, occurrencesIn, occursOn, shiftDay } from "../weeklyBlocks";

/** Cours du jeudi (2026-11-12 est un jeudi), session d'automne. */
const maths: BlockSpec = {
  id: "maths",
  title: "Maths",
  placeId: "cegep",
  startMinute: 10 * 60,
  endMinute: 12 * 60,
  weekday: 4,
  validFrom: "2026-08-24",
  validUntil: "2026-12-18",
};
const today = "2026-11-10";

describe("occursOn avec des jours annulés", () => {
  it("ignore seulement l'occurrence annulée", () => {
    const b = { ...maths, skipDays: ["2026-11-12"] };
    expect(occursOn(b, "2026-11-12")).toBe(false);
    expect(occursOn(b, "2026-11-19")).toBe(true);
    expect(occursOn(b, "2026-11-05")).toBe(true);
    expect(blocksOnDay([b], "2026-11-12")).toEqual([]);
    expect(occurrencesIn(b, { from: "2026-11-09", to: "2026-11-22" })).toEqual(["2026-11-19"]);
  });

  it("ne touche pas un bloc ponctuel", () => {
    const once: BlockSpec = {
      ...maths,
      weekday: null,
      validFrom: "2026-11-12",
      validUntil: null,
      skipDays: ["2026-11-12"],
    };
    expect(occursOn(once, "2026-11-12")).toBe(true);
  });
});

describe("skipOccurrence", () => {
  it("ajoute le jour, trié et sans doublon", () => {
    const first = skipOccurrence({ ...maths, skipDays: ["2026-11-26"] }, "2026-11-12", today);
    expect(first).toEqual({ ok: true, value: ["2026-11-12", "2026-11-26"] });
    const again = skipOccurrence({ ...maths, skipDays: ["2026-11-12"] }, "2026-11-12", today);
    expect(again).toEqual({ ok: true, value: ["2026-11-12"] });
  });

  it("retire au passage les jours annulés déjà passés", () => {
    const r = skipOccurrence({ ...maths, skipDays: ["2026-10-01"] }, "2026-11-12", today);
    expect(r).toEqual({ ok: true, value: ["2026-11-12"] });
  });

  it("accepte aujourd'hui, refuse hier", () => {
    expect(skipOccurrence(maths, "2026-11-12", "2026-11-12").ok).toBe(true);
    expect(skipOccurrence(maths, "2026-11-05", today).ok).toBe(false);
  });

  it("refuse un jour où le bloc n'a pas lieu", () => {
    expect(skipOccurrence(maths, "2026-11-11", today).ok).toBe(false); // mercredi
    expect(skipOccurrence(maths, "2026-12-24", today).ok).toBe(false); // après la session
  });

  it("refuse un bloc ponctuel", () => {
    const once = { ...maths, weekday: null, validFrom: "2026-11-12", validUntil: null };
    expect(skipOccurrence(once, "2026-11-12", today).ok).toBe(false);
  });

  it("respecte une répétition aux 2 semaines", () => {
    const b: BlockSpec = { ...maths, repeatUnit: "week", repeatEvery: 2, validFrom: "2026-11-05" };
    expect(skipOccurrence(b, "2026-11-12", today).ok).toBe(false); // semaine sans cours
    expect(skipOccurrence(b, "2026-11-19", today).ok).toBe(true);
  });

  it("refuse au-delà de la limite", () => {
    const daily: BlockSpec = {
      ...maths,
      weekday: null,
      repeatUnit: "day",
      repeatEvery: 1,
      validFrom: today,
      validUntil: null,
    };
    const full = Array.from({ length: MAX_SKIP_DAYS }, (_, i) => shiftDay(today, i));
    const r = skipOccurrence({ ...daily, skipDays: full }, shiftDay(today, MAX_SKIP_DAYS), today);
    expect(r.ok).toBe(false);
  });
});

describe("restoreOccurrence", () => {
  it("retire le jour et garde les autres", () => {
    const b = { ...maths, skipDays: ["2026-11-26", "2026-11-12"] };
    expect(restoreOccurrence(b, "2026-11-12")).toEqual(["2026-11-26"]);
    expect(restoreOccurrence(maths, "2026-11-12")).toEqual([]);
  });
});

describe("upcomingSkips", () => {
  it("liste les occurrences annulées à venir, par jour puis heure", () => {
    const anglais: BlockSpec = {
      ...maths,
      id: "anglais",
      title: "Anglais",
      startMinute: 8 * 60,
      endMinute: 10 * 60,
      skipDays: ["2026-11-12", "2026-11-05"],
    };
    const list = upcomingSkips(
      [{ ...maths, skipDays: ["2026-11-19", "2026-11-12"] }, anglais],
      today,
    );
    expect(list.map((s) => `${s.block.id}@${s.day}`)).toEqual([
      "anglais@2026-11-12",
      "maths@2026-11-12",
      "maths@2026-11-19",
    ]);
  });

  it("ignore un jour annulé qui ne correspond plus au bloc", () => {
    const moved = { ...maths, weekday: 2 as const, skipDays: ["2026-11-12"] };
    expect(upcomingSkips([moved], today)).toEqual([]);
  });
});

describe("validateSkipDay", () => {
  it("accepte une vraie date seulement", () => {
    expect(validateSkipDay("2026-11-12")).toEqual({ ok: true, value: "2026-11-12" });
    expect(validateSkipDay("2026-02-30").ok).toBe(false);
    expect(validateSkipDay("12/11/2026").ok).toBe(false);
    expect(validateSkipDay(null).ok).toBe(false);
  });
});

describe("conversion BD", () => {
  const row = {
    id: "maths",
    owner_id: "u1",
    title: "Maths",
    place_id: "cegep",
    start_time: "10:00:00",
    end_time: "12:00:00",
    weekday: 4,
    valid_from: "2026-08-24",
    valid_until: "2026-12-18",
    skip_days: ["2026-11-12"],
  };

  it("le cours annulé ne compte plus comme occupé ce jour-là", () => {
    const blocks = expandBusyBlock(row, { from: "2026-11-09", to: "2026-11-22" }, "maison");
    expect(blocks.map((b) => b.id)).toEqual(["maths@2026-11-19"]);
  });

  it("toBlockSpec garde les jours annulés, et marche sans la colonne (avant la 0021)", () => {
    expect(toBlockSpec(row).skipDays).toEqual(["2026-11-12"]);
    const { skip_days: _unused, ...old } = row;
    void _unused;
    expect(toBlockSpec(old).skipDays).toBeUndefined();
    expect(expandBusyBlock(old, { from: "2026-11-09", to: "2026-11-15" }, "maison")).toHaveLength(
      1,
    );
  });
});
