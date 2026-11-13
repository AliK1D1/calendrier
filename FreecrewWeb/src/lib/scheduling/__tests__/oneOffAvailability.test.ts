import { describe, expect, it } from "vitest";

import { findMeetups } from "../findMeetups";
import { getFreeWindows } from "../freeWindows";
import {
  applyOneOffAvailability,
  availabilityLabel,
  UNAVAILABLE_TITLE,
  validateAvailabilityForm,
} from "../oneOffAvailability";
import { zonedDayBounds, zonedTime } from "../time";
import type { BusyBlock, Person } from "../types";
import { FakeTravelProvider } from "./fakeTravel";
import { PLACES, leo } from "./fixtures";

const SAM = "2025-09-20"; // samedi
const t = (time: string, day = SAM) => zonedTime(day, time);
const HOME = "maison";
const busy = (id: string, start: string, end: string, placeId = "job", day = SAM): BusyBlock => ({
  id,
  start: t(start, day),
  end: t(end, day),
  placeId,
  title: id,
});
const span = (b: BusyBlock) => [b.id, b.start.toISOString(), b.end.toISOString(), b.placeId];

describe("applyOneOffAvailability", () => {
  it("sans disponibilité : rien ne change", () => {
    const blocks = [busy("job", "10:00", "18:00")];
    expect(applyOneOffAvailability(blocks, [], [], HOME)).toEqual(blocks);
  });

  it("« libre de 13 h à 18 h » : le reste de la journée devient occupé, à la maison", () => {
    const r = applyOneOffAvailability(
      [],
      [],
      [{ id: "d", day: SAM, start: "13:00", end: "18:00" }],
      HOME,
    );
    const day = zonedDayBounds(SAM);
    expect(r.map(span)).toEqual([
      ["indispo@2025-09-20#1", day.start.toISOString(), t("13:00").toISOString(), HOME],
      ["indispo@2025-09-20#2", t("18:00").toISOString(), day.end.toISOString(), HOME],
    ]);
    expect(r.every((b) => b.title === UNAVAILABLE_TITLE)).toBe(true);
  });

  it("lève un bloc hebdomadaire pendant la disponibilité, en garde le reste", () => {
    const r = applyOneOffAvailability(
      [busy("job@2025-09-20", "10:00", "18:00")],
      [],
      [{ id: "d", day: SAM, start: "13:00", end: "18:00" }],
      HOME,
    );
    expect(r.map(span)).toContainEqual([
      "job@2025-09-20",
      t("10:00").toISOString(),
      t("13:00").toISOString(),
      "job",
    ]);
    expect(r.some((b) => b.start < t("18:00") && b.end > t("13:00"))).toBe(false);
  });

  it("un bloc coupé en deux par une disponibilité au milieu : deux morceaux", () => {
    const r = applyOneOffAvailability(
      [busy("job", "10:00", "18:00")],
      [],
      [{ id: "d", day: SAM, start: "12:00", end: "14:00" }],
      HOME,
    );
    expect(r.filter((b) => b.placeId === "job").map(span)).toEqual([
      ["job#1", t("10:00").toISOString(), t("12:00").toISOString(), "job"],
      ["job#2", t("14:00").toISOString(), t("18:00").toISOString(), "job"],
    ]);
  });

  it("les blocs ponctuels (plan accepté, séance) restent occupés pendant la disponibilité", () => {
    const plan = busy("plan", "14:00", "15:00", "cafe");
    const r = applyOneOffAvailability(
      [],
      [plan],
      [{ id: "d", day: SAM, start: "13:00", end: "18:00" }],
      HOME,
    );
    expect(r).toContain(plan);
  });

  it("deux disponibilités le même jour (qui se chevauchent) : une seule union", () => {
    const r = applyOneOffAvailability(
      [],
      [],
      [
        { id: "a", day: SAM, start: "09:00", end: "11:00" },
        { id: "b", day: SAM, start: "10:30", end: "12:00" },
        { id: "c", day: SAM, start: "15:00", end: "24:00" },
      ],
      HOME,
    );
    expect(r.map((b) => [b.start.toISOString(), b.end.toISOString()])).toEqual([
      [zonedDayBounds(SAM).start.toISOString(), t("09:00").toISOString()],
      [t("12:00").toISOString(), t("15:00").toISOString()],
    ]);
  });

  it("jour du changement d'heure (2 novembre 2025, 25 h) : la journée entière est couverte", () => {
    const day = "2025-11-02";
    const r = applyOneOffAvailability(
      [],
      [],
      [{ id: "d", day, start: "13:00", end: "18:00" }],
      HOME,
    );
    const total = r.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()), 0) / 3_600_000;
    expect(total).toBe(25 - 5);
  });

  it("lève aussi les heures « je ne sors pas » (passées comme récurrentes)", () => {
    const calme = busy("calme-apres@2025-09-20", "21:00", "24:00", HOME);
    const r = applyOneOffAvailability(
      [calme],
      [],
      [{ id: "d", day: SAM, start: "19:00", end: "23:00" }],
      HOME,
    );
    expect(r.some((b) => b.start < t("23:00") && b.end > t("19:00"))).toBe(false);
  });
});

describe("le calcul des temps libres en tient compte", () => {
  // Léo travaille au Carrefour Laval le samedi de 10 h à 18 h (fixtures). Ce samedi-là, il se
  // dit libre de 13 h à 18 h (son shift est raccourci).
  const avecDispo: Person = {
    ...leo,
    busyBlocks: applyOneOffAvailability(
      leo.busyBlocks,
      [],
      [{ id: "d", day: SAM, start: "13:00", end: "18:00" }],
      leo.homePlaceId,
    ),
  };

  it("fenêtres libres de Léo ce samedi : 13 h → 18 h seulement", () => {
    const day = zonedDayBounds(SAM);
    const w = getFreeWindows(avecDispo, day.start, day.end);
    expect(w.map((x) => [x.start.toISOString(), x.end.toISOString()])).toEqual([
      [t("13:00").toISOString(), t("18:00").toISOString()],
    ]);
    // Il part du travail à 13 h et doit être rentré à 18 h.
    expect(w[0].placeBeforeId).toBe(PLACES.carrefourLaval.id);
    expect(w[0].placeAfterId).toBe(leo.homePlaceId);
    // Sans la disponibilité : libre avant 10 h et après 18 h, jamais l'après-midi.
    const sans = getFreeWindows(leo, day.start, day.end);
    expect(sans.some((x) => x.start < t("18:00") && x.end > t("13:00"))).toBe(false);
  });

  it("findMeetups propose l'après-midi de samedi, plus le soir", async () => {
    const amie: Person = {
      id: "amie",
      name: "Amie",
      homePlaceId: PLACES.leoHome.id,
      travelMode: "car",
      places: [PLACES.leoHome],
      busyBlocks: [],
    };
    const props = await findMeetups(
      [avecDispo, amie],
      {
        personIds: [avecDispo.id, amie.id],
        dates: { from: SAM, to: SAM },
        minDurationMinutes: 60,
        bufferMinutes: 5,
      },
      new FakeTravelProvider([], 10),
      { maxPerDay: 10 },
    );
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      expect(p.start.getTime()).toBeGreaterThanOrEqual(t("13:00").getTime());
      expect(p.end.getTime()).toBeLessThanOrEqual(t("18:00").getTime());
    }
  });
});

describe("validateAvailabilityForm", () => {
  const ok = { day: SAM, start: "13:00", end: "18:00", note: "  pas de shift " };
  const check = (raw: unknown) => validateAvailabilityForm(raw, "2025-09-15", "2026-09-15");

  it("accepte une disponibilité valide (note nettoyée, 24:00 permis)", () => {
    expect(check(ok)).toEqual({
      ok: true,
      value: { day: SAM, startMinute: 780, endMinute: 1080, note: "pas de shift" },
    });
    expect(check({ day: SAM, start: "20:00", end: "24:00" }).ok).toBe(true);
  });

  it("refuse jour passé ou trop loin, jour inexistant, heures à l'envers ou trop courtes", () => {
    expect(check({ ...ok, day: "2025-09-14" }).ok).toBe(false);
    expect(check({ ...ok, day: "2026-09-16" }).ok).toBe(false);
    expect(check({ ...ok, day: "2025-02-30" }).ok).toBe(false);
    expect(check({ ...ok, start: "18:00", end: "13:00" }).ok).toBe(false);
    expect(check({ ...ok, start: "13:00", end: "13:10" }).ok).toBe(false);
    expect(check({ ...ok, start: "25:00" }).ok).toBe(false);
    expect(check(null).ok).toBe(false);
  });

  it("refuse une note trop longue ou avec des caractères de contrôle", () => {
    expect(check({ ...ok, note: "x".repeat(61) }).ok).toBe(false);
    expect(check({ ...ok, note: "ligne\nautre" }).ok).toBe(false);
    expect(check({ ...ok, note: "a\u0085b" }).ok).toBe(false);
    expect(check({ ...ok, note: 3 }).ok).toBe(false);
  });

  it("libellé à la québécoise", () => {
    expect(availabilityLabel(780, 1080)).toBe("13 h – 18 h");
    expect(availabilityLabel(1230, 1440)).toBe("20 h 30 – minuit");
  });
});
