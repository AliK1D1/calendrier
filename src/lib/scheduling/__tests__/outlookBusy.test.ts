import { describe, expect, it } from "vitest";

import {
  allDayRange,
  countsAsBusy,
  type ExternalBusyEvent,
  isSyncDue,
  mergeDayPieces,
  outlookEventsToDayPieces,
  outlookSyncRange,
  rangeInstants,
} from "../outlookBusy";

const RANGE = { from: "2026-11-02", to: "2026-12-27" };
const timed = (start: string, end: string): ExternalBusyEvent => ({
  kind: "timed",
  start: new Date(start),
  end: new Date(end),
});

describe("countsAsBusy", () => {
  it("« Disponible » et annulé ne comptent pas ; le reste compte comme occupé", () => {
    expect(countsAsBusy("free", false)).toBe(false);
    expect(countsAsBusy("busy", true)).toBe(false);
    for (const s of ["busy", "tentative", "oof", "workingElsewhere", "unknown", "autre", null]) {
      expect(countsAsBusy(s, false)).toBe(true);
    }
  });
});

describe("outlookSyncRange", () => {
  it("du lundi de la semaine en cours à la fin de la 8e semaine (jour local de Toronto)", () => {
    // Mercredi 4 novembre 2026, 14 h UTC (9 h à Toronto).
    expect(outlookSyncRange(new Date("2026-11-04T14:00:00Z"))).toEqual({
      from: "2026-11-02",
      to: "2026-12-27",
    });
  });

  it("utilise le jour de Toronto, pas celui d'UTC (lundi 2 h UTC = dimanche soir ici)", () => {
    expect(outlookSyncRange(new Date("2026-11-09T02:00:00Z")).from).toBe("2026-11-02");
  });

  it("rangeInstants couvre de minuit local au minuit local suivant", () => {
    const r = rangeInstants({ from: "2026-11-02", to: "2026-11-02" });
    expect(r.start.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });
});

describe("isSyncDue", () => {
  const now = new Date("2026-11-04T14:00:00Z");
  it("jamais essayé ou date illisible : à faire", () => {
    expect(isSyncDue(null, now, 15)).toBe(true);
    expect(isSyncDue("pas une date", now, 15)).toBe(true);
  });
  it("à faire après l'intervalle, pas avant", () => {
    expect(isSyncDue("2026-11-04T13:46:00Z", now, 15)).toBe(false);
    expect(isSyncDue("2026-11-04T13:45:00Z", now, 15)).toBe(true);
  });
});

describe("outlookEventsToDayPieces", () => {
  it("convertit un événement en heures locales (HNE)", () => {
    // 15 h à 16 h 30 UTC = 10 h à 11 h 30 à Toronto (heure normale).
    const r = outlookEventsToDayPieces(
      [timed("2026-11-04T15:00:00Z", "2026-11-04T16:30:00Z")],
      RANGE,
    );
    expect(r).toEqual({
      pieces: [{ day: "2026-11-04", startMinute: 600, endMinute: 690 }],
      truncated: false,
    });
  });

  it("coupe à minuit un événement qui traverse la nuit", () => {
    // 22 h → 1 h (heure de Toronto).
    const r = outlookEventsToDayPieces(
      [timed("2026-11-05T03:00:00Z", "2026-11-05T06:00:00Z")],
      RANGE,
    );
    expect(r.pieces).toEqual([
      { day: "2026-11-04", startMinute: 22 * 60, endMinute: 1440 },
      { day: "2026-11-05", startMinute: 0, endMinute: 60 },
    ]);
  });

  it("un événement de plusieurs jours occupe chaque jour en entier au milieu", () => {
    const r = outlookEventsToDayPieces(
      [timed("2026-11-06T22:00:00Z", "2026-11-08T14:00:00Z")], // ven. 17 h → dim. 9 h
      RANGE,
    );
    expect(r.pieces).toEqual([
      { day: "2026-11-06", startMinute: 17 * 60, endMinute: 1440 },
      { day: "2026-11-07", startMinute: 0, endMinute: 1440 },
      { day: "2026-11-08", startMinute: 0, endMinute: 9 * 60 },
    ]);
  });

  it("événement « toute la journée » : jours entiers", () => {
    const r = outlookEventsToDayPieces(
      [{ kind: "allDay", firstDay: "2026-11-10", lastDay: "2026-11-11" }],
      RANGE,
    );
    expect(r.pieces).toEqual([
      { day: "2026-11-10", startMinute: 0, endMinute: 1440 },
      { day: "2026-11-11", startMinute: 0, endMinute: 1440 },
    ]);
  });

  it("garde seulement les jours de la plage", () => {
    const r = outlookEventsToDayPieces(
      [
        timed("2026-10-30T15:00:00Z", "2026-10-30T16:00:00Z"), // avant
        timed("2026-12-28T15:00:00Z", "2026-12-28T16:00:00Z"), // après
        { kind: "allDay", firstDay: "2026-10-01", lastDay: "2026-11-02" }, // déborde avant
        timed("2026-12-27T15:00:00Z", "2027-06-01T00:00:00Z"), // déborde après (6 mois)
      ],
      RANGE,
    );
    expect(r.pieces).toEqual([
      { day: "2026-11-02", startMinute: 0, endMinute: 1440 },
      { day: "2026-12-27", startMinute: 10 * 60, endMinute: 1440 },
    ]);
  });

  it("ignore un événement vide ou à l'envers", () => {
    const r = outlookEventsToDayPieces(
      [
        timed("2026-11-04T15:00:00Z", "2026-11-04T15:00:00Z"),
        timed("2026-11-04T16:00:00Z", "2026-11-04T15:00:00Z"),
      ],
      RANGE,
    );
    expect(r.pieces).toEqual([]);
  });

  it("fusionne les événements qui se chevauchent ou se touchent", () => {
    const r = outlookEventsToDayPieces(
      [
        timed("2026-11-04T15:00:00Z", "2026-11-04T16:00:00Z"), // 10 h–11 h
        timed("2026-11-04T15:30:00Z", "2026-11-04T16:30:00Z"), // 10 h 30–11 h 30
        timed("2026-11-04T16:30:00Z", "2026-11-04T17:00:00Z"), // 11 h 30–12 h (collé)
        timed("2026-11-04T18:00:00Z", "2026-11-04T19:00:00Z"), // 13 h–14 h
      ],
      RANGE,
    );
    expect(r.pieces).toEqual([
      { day: "2026-11-04", startMinute: 600, endMinute: 720 },
      { day: "2026-11-04", startMinute: 780, endMinute: 840 },
    ]);
  });

  it("arrondit vers l'extérieur à la minute", () => {
    const r = outlookEventsToDayPieces(
      [timed("2026-11-04T15:00:30Z", "2026-11-04T15:59:10Z")],
      RANGE,
    );
    expect(r.pieces).toEqual([{ day: "2026-11-04", startMinute: 600, endMinute: 660 }]);
  });

  it("heure avancée (mars) : heures d'horloge, journée de 23 h", () => {
    const range = { from: "2027-03-08", to: "2027-03-15" };
    // Dimanche 14 mars 2027 : 1 h HNE (06:00Z) → 4 h HAE (08:00Z), 2 h réelles.
    const r = outlookEventsToDayPieces(
      [timed("2027-03-14T06:00:00Z", "2027-03-14T08:00:00Z")],
      range,
    );
    expect(r.pieces).toEqual([{ day: "2027-03-14", startMinute: 60, endMinute: 240 }]);
    // Toute la journée en instants : de minuit à minuit (23 h réelles).
    const d = outlookEventsToDayPieces(
      [timed("2027-03-14T05:00:00Z", "2027-03-15T04:00:00Z")],
      range,
    );
    expect(d.pieces).toEqual([{ day: "2027-03-14", startMinute: 0, endMinute: 1440 }]);
  });

  it("retour à l'heure normale (novembre) : une fin d'horloge avant le début garde la vraie durée", () => {
    const range = { from: "2026-10-26", to: "2026-11-08" };
    // Dimanche 1er novembre 2026 : 1 h 45 HAE (05:45Z) → 1 h 15 HNE (06:15Z), 30 min réelles.
    const r = outlookEventsToDayPieces(
      [timed("2026-11-01T05:45:00Z", "2026-11-01T06:15:00Z")],
      range,
    );
    expect(r.pieces).toEqual([{ day: "2026-11-01", startMinute: 105, endMinute: 135 }]);
  });

  it("s'arrête à maxBlocks en gardant les plus proches", () => {
    const events: ExternalBusyEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const h = String(14 + i * 2).padStart(2, "0");
      events.push(timed(`2026-11-04T${h}:00:00Z`, `2026-11-04T${h}:30:00Z`));
    }
    const r = outlookEventsToDayPieces(events, RANGE, { maxBlocks: 3 });
    expect(r.truncated).toBe(true);
    expect(r.pieces.map((p) => p.startMinute)).toEqual([540, 660, 780]);
  });
});

describe("mergeDayPieces", () => {
  it("ne fusionne pas deux jours différents", () => {
    expect(
      mergeDayPieces([
        { day: "2026-11-05", startMinute: 0, endMinute: 60 },
        { day: "2026-11-04", startMinute: 1380, endMinute: 1440 },
      ]),
    ).toEqual([
      { day: "2026-11-04", startMinute: 1380, endMinute: 1440 },
      { day: "2026-11-05", startMinute: 0, endMinute: 60 },
    ]);
  });
});

describe("allDayRange", () => {
  it("la fin de Graph est exclusive", () => {
    expect(allDayRange("2026-11-04T00:00:00.0000000", "2026-11-05T00:00:00.0000000")).toEqual({
      from: "2026-11-04",
      to: "2026-11-04",
    });
    expect(allDayRange("2026-11-04T00:00:00", "2026-11-07T00:00:00")).toEqual({
      from: "2026-11-04",
      to: "2026-11-06",
    });
  });
  it("dates illisibles : null ; fin avant le début : un seul jour", () => {
    expect(allDayRange("n'importe quoi", "2026-11-05")).toBeNull();
    expect(allDayRange("2026-02-30T00:00:00", "2026-03-01T00:00:00")).toBeNull();
    expect(allDayRange("2026-11-04", "2026-11-04")).toEqual({
      from: "2026-11-04",
      to: "2026-11-04",
    });
  });
});
