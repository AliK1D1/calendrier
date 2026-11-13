/** Story 5 : plans récurrents (validation, prochaine fois, libellés, .ics). */
import { describe, expect, it } from "vitest";

import { buildPlanIcs, seriesRrule } from "../ics";
import { validatePropose, validateRepeat } from "../validation";
import {
  buildPlanViews,
  countAwaiting,
  groupPlans,
  nextPlanOccurrence,
  planRepeatLabel,
  type PlanRow,
} from "../view";

const G = "11111111-1111-4111-8111-111111111111";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const NOW = new Date("2027-03-10T15:00:00Z"); // mercredi 10 mars 2027, 10 h (HNE)

const form = (over: Record<string, unknown> = {}) => ({
  groupId: G,
  title: "Gym",
  date: "2027-03-16",
  start: "18:00",
  durationMinutes: 90,
  placeId: null,
  location: "",
  inviteeIds: [B],
  ...over,
});

/** Gym tous les 2 jours à partir du mardi 16 mars 2027, 18 h – 19 h 30 (HAE, UTC-4). */
const gym = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "gym",
  group_id: G,
  title: "Gym",
  location: "",
  place_id: null,
  starts_at: "2027-03-16T22:00:00Z",
  ends_at: "2027-03-16T23:30:00Z",
  status: "proposed",
  created_by: A,
  created_at: "2027-03-10T14:00:00Z",
  repeat_unit: "day",
  repeat_every: 2,
  repeat_until: null,
  ...over,
});

const ctx = (myId: string, now = NOW) => ({
  myId,
  now,
  names: new Map([
    [A, "Ali"],
    [B, "Sam"],
  ]),
  groupNames: new Map([[G, "Gang"]]),
  placeNames: new Map<string, string>(),
  groupMembers: new Map([[G, [A, B]]]),
});

describe("validateRepeat / validatePropose avec répétition", () => {
  it("une seule fois par défaut", () => {
    const r = validatePropose(form(), NOW);
    expect(r.ok && r.value.repeat).toBeNull();
  });

  it("garde la répétition et sa fin", () => {
    const r = validatePropose(
      form({ repeat: { unit: "day", every: 2, until: "2027-06-30" } }),
      NOW,
    );
    expect(r.ok && r.value.repeat).toEqual({ unit: "day", every: 2, until: "2027-06-30" });
    const sansFin = validatePropose(form({ repeat: { unit: "week", every: 1, until: "" } }), NOW);
    expect(sansFin.ok && sansFin.value.repeat).toEqual({ unit: "week", every: 1, until: null });
  });

  it("refuse une répétition invalide", () => {
    expect(validateRepeat({ unit: "hour", every: 1 }, "2027-03-16")).toEqual({
      ok: false,
      error: "Répétition invalide.",
    });
    expect(validateRepeat({ unit: "day", every: 0 }, "2027-03-16").ok).toBe(false);
    expect(validateRepeat({ unit: "day", every: 100 }, "2027-03-16").ok).toBe(false);
    expect(validateRepeat({ unit: "day", every: 1.5 }, "2027-03-16").ok).toBe(false);
    expect(validateRepeat({ unit: "day", every: 1, until: "2027-03-15" }, "2027-03-16")).toEqual({
      ok: false,
      error: "La fin doit être après la première fois.",
    });
    expect(validateRepeat({ unit: "day", every: 1, until: "2027-02-31" }, "2027-03-16").ok).toBe(
      false,
    );
    expect(validateRepeat({ unit: "day", every: 1, until: "2037-03-13" }, "2027-03-16").ok).toBe(
      false,
    );
    expect(validateRepeat({ unit: "day", every: 1, until: "2037-03-12" }, "2027-03-16").ok).toBe(
      true,
    );
    expect(validateRepeat("tous les jours", "2027-03-16").ok).toBe(false);
  });
});

describe("nextPlanOccurrence", () => {
  it("avant la première fois : la première fois", () => {
    expect(nextPlanOccurrence(gym(), NOW)).toEqual({
      start: new Date("2027-03-16T22:00:00Z"),
      end: new Date("2027-03-16T23:30:00Z"),
    });
  });

  it("pendant une occurrence : elle-même ; après : la suivante (2 jours plus tard)", () => {
    const during = new Date("2027-03-18T22:30:00Z");
    expect(nextPlanOccurrence(gym(), during)?.start).toEqual(new Date("2027-03-18T22:00:00Z"));
    const after = new Date("2027-03-18T23:45:00Z");
    expect(nextPlanOccurrence(gym(), after)?.start).toEqual(new Date("2027-03-20T22:00:00Z"));
  });

  it("garde 18 h à l'heure locale après le passage à l'heure normale (novembre)", () => {
    const next = nextPlanOccurrence(
      gym({ repeat_every: 1 }),
      new Date("2027-11-08T12:00:00Z"), // lundi 8 novembre 2027, HNE (UTC-5)
    );
    expect(next?.start).toEqual(new Date("2027-11-08T23:00:00Z"));
  });

  it("série finie (dernier jour passé) : null ; une seule fois finie : null", () => {
    expect(
      nextPlanOccurrence(gym({ repeat_until: "2027-03-20" }), new Date("2027-03-21T12:00:00Z")),
    ).toBeNull();
    expect(
      nextPlanOccurrence(
        gym({ repeat_unit: null, repeat_every: 1 }),
        new Date("2027-03-17T12:00:00Z"),
      ),
    ).toBeNull();
  });
});

describe("planRepeatLabel", () => {
  it("décrit la répétition en mots", () => {
    expect(planRepeatLabel(gym())).toBe("Tous les 2 jours");
    expect(planRepeatLabel(gym({ repeat_every: 1, repeat_until: "2027-06-30" }))).toBe(
      "Tous les jours, jusqu'au 30 juin 2027",
    );
    expect(planRepeatLabel(gym({ repeat_unit: "week", repeat_every: 1 }))).toBe(
      "Chaque semaine, le mardi",
    );
    expect(planRepeatLabel(gym({ repeat_unit: "week", repeat_every: 2 }))).toBe(
      "Toutes les 2 semaines, le mardi",
    );
    expect(planRepeatLabel(gym({ repeat_unit: "month", repeat_every: 1 }))).toBe(
      "Chaque mois, le 16",
    );
    expect(planRepeatLabel(gym({ repeat_unit: null, repeat_every: 1 }))).toBeNull();
  });
});

describe("buildPlanViews avec une série", () => {
  const invitees = [A, B].map((u) => ({ plan_id: "gym", user_id: u }));
  const votes = [{ plan_id: "gym", user_id: A, vote: "yes" as const }];

  it("montre la prochaine fois, reste « à venir » et attend ma réponse après la première fois", () => {
    const now = new Date("2027-03-19T12:00:00Z");
    const [v] = buildPlanViews([gym()], invitees, votes, ctx(B, now));
    expect(v).toMatchObject({
      dayLabel: "samedi 20 mars",
      timeLabel: "18 h – 19 h 30",
      state: "upcoming",
      repeatLabel: "Tous les 2 jours",
      startsAt: "2027-03-20T22:00:00.000Z",
      series: {
        unit: "day",
        every: 2,
        until: null,
        firstStartsAt: "2027-03-16T22:00:00Z",
        firstEndsAt: "2027-03-16T23:30:00Z",
      },
    });
    expect(groupPlans([v]).awaiting).toHaveLength(1);
  });

  it("série finie : passée ; série arrêtée : annulée", () => {
    const now = new Date("2027-04-01T12:00:00Z");
    const [fini] = buildPlanViews(
      [gym({ repeat_until: "2027-03-30" })],
      invitees,
      votes,
      ctx(B, now),
    );
    expect(fini.state).toBe("past");
    const [arrete] = buildPlanViews([gym({ status: "cancelled" })], invitees, votes, ctx(B, now));
    expect(arrete.state).toBe("cancelled");
  });

  it("countAwaiting compte une série commencée mais pas finie", () => {
    const now = new Date("2027-04-01T12:00:00Z");
    expect(countAwaiting([{ plan_id: "gym", ...gym() }], [], B, now)).toBe(1);
    expect(
      countAwaiting([{ plan_id: "gym", ...gym({ repeat_until: "2027-03-30" }) }], [], B, now),
    ).toBe(0);
  });
});

describe(".ics d'une série", () => {
  const series = (over: Partial<Parameters<typeof seriesRrule>[0]> = {}) => ({
    unit: "day" as const,
    every: 2,
    until: null,
    firstStartsAt: "2027-03-16T22:00:00Z",
    firstEndsAt: "2027-03-16T23:30:00Z",
    ...over,
  });

  it("une série en heure locale avec RRULE et un rappel 30 min avant", () => {
    const ics = buildPlanIcs(
      {
        id: "gym",
        title: "Gym",
        where: "Gym du cégep",
        groupName: "Gang",
        startsAt: "2027-03-20T22:00:00.000Z",
        endsAt: "2027-03-20T23:30:00.000Z",
        series: series({ until: "2027-06-30" }),
      },
      NOW,
    );
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20270316T180000\r\n");
    expect(ics).toContain("DTEND;TZID=America/Toronto:20270316T193000\r\n");
    // Fin du 30 juin, 23 h 59 HAE = 1er juillet 03 h 59 UTC.
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20270701T035900Z\r\n");
    expect(ics).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Gym\r\nTRIGGER:-PT30M\r\n",
    );
    expect(ics).not.toContain("DTSTART:");
  });

  it("mois et ans : un 31 prend le dernier jour des mois courts", () => {
    expect(seriesRrule(series({ unit: "week", every: 1 }))).toBe("FREQ=WEEKLY;INTERVAL=1");
    expect(seriesRrule(series({ unit: "month", every: 1 }))).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=16",
    );
    expect(
      seriesRrule(
        series({
          unit: "month",
          every: 1,
          firstStartsAt: "2027-01-31T23:00:00Z",
          firstEndsAt: "2027-02-01T00:00:00Z",
        }),
      ),
    ).toBe("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(
      seriesRrule(
        series({
          unit: "year",
          every: 1,
          firstStartsAt: "2028-02-29T23:00:00Z",
          firstEndsAt: "2028-03-01T00:00:00Z",
        }),
      ),
    ).toBe("FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
  });
});
