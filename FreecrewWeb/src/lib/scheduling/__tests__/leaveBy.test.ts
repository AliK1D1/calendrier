import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import { leaveByTime, previousStop, transitQueryFor } from "../leaveBy";
import { TIME_ZONE, zonedTime } from "../time";
import type { BusyBlock } from "../types";

const HOME = "maison";
const D = "2025-09-16"; // un mardi ordinaire (HAE)

const t = (time: string, day: string = D) => zonedTime(day, time);
const local = (d: Date) => formatInTimeZone(d, TIME_ZONE, "yyyy-MM-dd HH:mm");

function b(start: string, end: string, placeId: string, day: string = D): BusyBlock {
  return {
    id: `${placeId}-${day}-${start}`,
    start: t(start, day),
    end: t(end, day),
    placeId,
    title: placeId,
  };
}

describe("previousStop", () => {
  it("prend le lieu du dernier bloc fini avant le plan", () => {
    const blocks = [
      b("08:00", "10:00", "cegep"),
      b("12:00", "15:30", "travail"),
      b("18:00", "19:00", "gym"),
    ];
    const s = previousStop(blocks, t("16:00"), HOME);
    expect(s.placeId).toBe("travail");
    expect(s.end && local(s.end)).toBe(`${D} 15:30`);
  });

  it("maison s'il n'y a rien avant le plan ce jour-là", () => {
    const blocks = [b("18:00", "19:00", "gym"), b("13:00", "15:00", "cegep", "2025-09-15")];
    expect(previousStop(blocks, t("16:00"), HOME)).toEqual({ placeId: HOME, end: null });
  });

  it("un bloc qui déborde sur le plan compte (retard)", () => {
    const s = previousStop([b("14:00", "16:30", "cegep")], t("16:00"), HOME);
    expect(s.placeId).toBe("cegep");
    expect(s.end && local(s.end)).toBe(`${D} 16:30`);
  });

  it("blocs collés : lieu du bloc qui finit le plus tard", () => {
    const s = previousStop(
      [b("10:00", "12:00", "cegep"), b("12:00", "15:00", "biblio")],
      t("16:00"),
      HOME,
    );
    expect(s.placeId).toBe("biblio");
  });

  it("ignore un bloc qui commence pile au début du plan", () => {
    expect(previousStop([b("16:00", "17:00", "cegep")], t("16:00"), HOME)).toEqual({
      placeId: HOME,
      end: null,
    });
  });
});

describe("leaveByTime", () => {
  it("cas normal : départ = début − trajet − marge", () => {
    const r = leaveByTime({
      planStart: t("16:30"),
      previous: { placeId: "cegep", end: t("15:00") },
      travelMinutes: 23,
      bufferMinutes: 5,
    });
    expect(r.kind).toBe("go");
    if (r.kind !== "go") return;
    expect(local(r.leaveAt)).toBe(`${D} 16:02`);
    expect(local(r.arriveAt)).toBe(`${D} 16:25`);
    expect(r.lateMinutes).toBe(0);
    expect(r.usedTransit).toBe(false);
  });

  it("commence juste après un cours : départ à la fin du cours, retard annoncé", () => {
    const r = leaveByTime({
      planStart: t("16:00"),
      previous: { placeId: "cegep", end: t("15:45") },
      travelMinutes: 27,
      bufferMinutes: 5,
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(local(r.leaveAt)).toBe(`${D} 15:45`);
    expect(local(r.arriveAt)).toBe(`${D} 16:12`);
    expect(r.lateMinutes).toBe(12);
  });

  it("marge entamée mais pas de retard", () => {
    const r = leaveByTime({
      planStart: t("16:00"),
      previous: { placeId: "cegep", end: t("15:40") },
      travelMinutes: 18,
      bufferMinutes: 5,
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(local(r.leaveAt)).toBe(`${D} 15:40`);
    expect(r.lateMinutes).toBe(0);
  });

  it("aucun bloc avant (maison) : pas de contrainte de départ", () => {
    const r = leaveByTime({
      planStart: t("10:00"),
      previous: { placeId: HOME, end: null },
      travelMinutes: 40,
      bufferMinutes: 5,
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(local(r.leaveAt)).toBe(`${D} 09:15`);
    expect(r.lateMinutes).toBe(0);
  });

  it("même lieu : pas de trajet ; retard si le bloc déborde", () => {
    expect(
      leaveByTime({
        planStart: t("16:00"),
        previous: { placeId: "cegep", end: t("15:00") },
        travelMinutes: 0,
        bufferMinutes: 5,
      }),
    ).toEqual({ kind: "there", lateMinutes: 0 });
    expect(
      leaveByTime({
        planStart: t("16:00"),
        previous: { placeId: "cegep", end: t("16:10") },
        travelMinutes: 0,
        bufferMinutes: 5,
      }),
    ).toEqual({ kind: "there", lateMinutes: 10 });
  });

  it("transport en commun réel : ses heures de départ et d'arrivée", () => {
    const r = leaveByTime({
      planStart: t("16:30"),
      previous: { placeId: "cegep", end: t("15:00") },
      travelMinutes: 30,
      bufferMinutes: 5,
      transit: { departAt: t("15:42"), arriveAt: t("16:05") },
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(local(r.leaveAt)).toBe(`${D} 15:42`);
    expect(local(r.arriveAt)).toBe(`${D} 16:05`);
    expect(r.usedTransit).toBe(true);
    expect(r.lateMinutes).toBe(0);
  });

  it("transport en commun qui arrive après le début : retard", () => {
    const r = leaveByTime({
      planStart: t("16:00"),
      previous: { placeId: "cegep", end: t("15:45") },
      travelMinutes: 20,
      bufferMinutes: 5,
      transit: { departAt: t("15:50"), arriveAt: t("16:12") },
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(r.usedTransit).toBe(true);
    expect(r.lateMinutes).toBe(12);
  });

  it("trajet réel qui part avant la fin de mon bloc : ignoré (heure impossible)", () => {
    const r = leaveByTime({
      planStart: t("16:00"),
      previous: { placeId: "cegep", end: t("15:45") },
      travelMinutes: 20,
      bufferMinutes: 5,
      transit: { departAt: t("15:30"), arriveAt: t("15:52") },
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    expect(r.usedTransit).toBe(false);
    expect(local(r.leaveAt)).toBe(`${D} 15:45`);
    expect(r.lateMinutes).toBe(5);
  });

  it("jour de changement d'heure : calcul en vraies minutes", () => {
    // 2026-03-08 : à 2 h, on passe à 3 h. Plan à 3 h 30, 45 min de trajet + 5 de marge.
    const day = "2026-03-08";
    const r = leaveByTime({
      planStart: t("03:30", day),
      previous: { placeId: HOME, end: null },
      travelMinutes: 45,
      bufferMinutes: 5,
    });
    if (r.kind !== "go") throw new Error("attendu : go");
    // 50 vraies minutes avant 3 h 30 HAE = 1 h 40 HNE (2 h → 3 h n'existe pas).
    expect(local(r.leaveAt)).toBe(`${day} 01:40`);
    expect(local(r.arriveAt)).toBe(`${day} 03:25`);
  });

  it("horloge injectée : « il est temps de partir »", () => {
    const input = {
      planStart: t("16:30"),
      previous: { placeId: HOME, end: null },
      travelMinutes: 20,
      bufferMinutes: 5,
    };
    const before = leaveByTime({ ...input, now: t("15:00") });
    const after = leaveByTime({ ...input, now: t("16:10") });
    expect(before.kind === "go" && before.timeToGo).toBe(false);
    expect(after.kind === "go" && after.timeToGo).toBe(true);
  });

  it("refuse un trajet ou une marge invalide", () => {
    const base = { planStart: t("16:00"), previous: { placeId: HOME, end: null } };
    expect(() => leaveByTime({ ...base, travelMinutes: Number.NaN, bufferMinutes: 5 })).toThrow();
    expect(() => leaveByTime({ ...base, travelMinutes: 10, bufferMinutes: -1 })).toThrow();
  });
});

describe("transitQueryFor", () => {
  it("arriver avant le plan (moins la marge) quand j'ai le temps", () => {
    const q = transitQueryFor(t("16:30"), { placeId: "cegep", end: t("15:00") }, 25, 5);
    expect("arrivalTime" in q && local(q.arrivalTime)).toBe(`${D} 16:25`);
  });

  it("partir à la fin du bloc quand je n'ai pas le temps", () => {
    const q = transitQueryFor(t("16:00"), { placeId: "cegep", end: t("15:45") }, 25, 5);
    expect("departureTime" in q && local(q.departureTime)).toBe(`${D} 15:45`);
  });

  it("depuis la maison : arriver avant le plan", () => {
    const q = transitQueryFor(t("10:00"), { placeId: HOME, end: null }, 25, 5);
    expect("arrivalTime" in q).toBe(true);
  });
});
