import { describe, expect, it } from "vitest";

import {
  cleanName,
  icsBlocksToRows,
  icsCalendarName,
  piecesToRows,
  subscriptionRange,
} from "../subscriptions";

describe("calendriers abonnés : fenêtre et conversion", () => {
  it("lit du lundi de la semaine en cours à la fin de la 8e semaine (fuseau de Toronto)", () => {
    // Jeudi 5 novembre 2026, 13 h 30 UTC = 8 h 30 à Toronto.
    expect(subscriptionRange(new Date("2026-11-05T13:30:00Z"))).toEqual({
      from: "2026-11-02",
      to: "2026-12-27",
    });
    // Lundi 2 novembre, 3 h UTC = dimanche 1er novembre 22 h à Toronto : semaine précédente.
    expect(subscriptionRange(new Date("2026-11-02T03:00:00Z")).from).toBe("2026-10-26");
  });

  it("garde les blocs de la fenêtre, ponctuels sans fin, hebdomadaires avec fin, triés", () => {
    const range = { from: "2026-11-02", to: "2026-12-27" };
    const rows = icsBlocksToRows(
      [
        {
          title: "GP du Brésil",
          startMinute: 780,
          endMinute: 900,
          weekday: null,
          validFrom: "2026-11-08",
          validUntil: "2026-11-08",
        },
        {
          title: "Ligue",
          startMinute: 1140,
          endMinute: 1260,
          weekday: 3,
          validFrom: "2026-11-04",
          validUntil: "2026-12-16",
        },
        {
          title: "Passé",
          startMinute: 600,
          endMinute: 660,
          weekday: null,
          validFrom: "2026-10-01",
          validUntil: "2026-10-01",
        },
      ],
      range,
    );
    expect(rows).toEqual([
      {
        title: "Ligue",
        start: "19:00",
        end: "21:00",
        weekday: 3,
        from: "2026-11-04",
        until: "2026-12-16",
      },
      {
        title: "GP du Brésil",
        start: "13:00",
        end: "15:00",
        weekday: null,
        from: "2026-11-08",
        until: null,
      },
    ]);
  });

  it("morceaux Outlook → événements ponctuels au nom du calendrier (minuit = 24:00)", () => {
    expect(
      piecesToRows([{ day: "2026-11-08", startMinute: 1320, endMinute: 1440 }], "Fériés"),
    ).toEqual([
      {
        title: "Fériés",
        start: "22:00",
        end: "24:00",
        weekday: null,
        from: "2026-11-08",
        until: null,
      },
    ]);
  });

  it("nettoie les noms (une ligne, 100 caractères)", () => {
    expect(cleanName("  Formule\n1\t ", "x")).toBe("Formule 1");
    expect(cleanName("   ", "Calendrier")).toBe("Calendrier");
    const long = cleanName("a".repeat(150), "");
    expect(long).toHaveLength(100);
    expect(long.endsWith("…")).toBe(true);
  });

  it("lit X-WR-CALNAME (lignes repliées, échappements)", () => {
    expect(
      icsCalendarName(
        "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Formula 1 \\, saison\r\n  2026\r\nEND:VCALENDAR",
      ),
    ).toBe("Formula 1 , saison 2026");
    expect(icsCalendarName("BEGIN:VCALENDAR\nX-WR-CALNAME;VALUE=TEXT:NHL\nEND:VCALENDAR")).toBe(
      "NHL",
    );
    expect(icsCalendarName("BEGIN:VCALENDAR\nEND:VCALENDAR")).toBe("");
  });
});
