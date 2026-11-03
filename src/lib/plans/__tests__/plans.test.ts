import { describe, expect, it } from "vitest";

import { buildPlanIcs, escapeIcsText } from "../ics";
import { defaultFreeSlot, draftFromSlot, validatePropose } from "../validation";
import { buildPlanViews, countAwaiting, groupPlans, isAwaitingMe, type PlanRow } from "../view";

const G = "11111111-1111-4111-8111-111111111111";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const NOW = new Date("2027-03-10T15:00:00Z"); // mercredi 10 mars 2027, 10 h (HNE)

const form = (over: Record<string, unknown> = {}) => ({
  groupId: G,
  title: "  Souper   chez Sam ",
  date: "2027-03-16",
  start: "18:00",
  durationMinutes: 120,
  placeId: null,
  location: "",
  inviteeIds: null,
  ...over,
});

describe("validatePropose", () => {
  it("convertit l'heure locale en instants (heure avancée commencée le 14 mars)", () => {
    const r = validatePropose(form(), NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        groupId: G,
        title: "Souper chez Sam",
        startsAt: "2027-03-16T22:00:00.000Z",
        endsAt: "2027-03-17T00:00:00.000Z",
        placeId: null,
        location: "",
        inviteeIds: null,
      },
    });
  });

  it("garde les invités choisis, sans doublon", () => {
    const r = validatePropose(form({ inviteeIds: [B, B.toUpperCase(), C] }), NOW);
    expect(r.ok && r.value.inviteeIds).toEqual([B, C]);
    expect(validatePropose(form({ inviteeIds: [] }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ inviteeIds: ["x"] }), NOW)).toMatchObject({ ok: false });
  });

  it("refuse titre vide ou trop long, lieu trop long, durée hors bornes", () => {
    expect(validatePropose(form({ title: "   " }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ title: "x".repeat(81) }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ location: "x".repeat(101) }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ durationMinutes: 10 }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ durationMinutes: 721 }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ durationMinutes: 720, start: "08:00" }), NOW)).toMatchObject({
      ok: true,
    });
  });

  it("refuse un moment passé, trop lointain, ou qui dépasse minuit ; accepte de finir à minuit", () => {
    expect(validatePropose(form({ date: "2027-03-10", start: "09:00" }), NOW)).toEqual({
      ok: false,
      error: "Ce moment est déjà commencé ou passé.",
    });
    expect(validatePropose(form({ date: "2028-04-01" }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ start: "23:00", durationMinutes: 120 }), NOW)).toEqual({
      ok: false,
      error: "Un plan finit le même jour (au plus tard à minuit).",
    });
    expect(validatePropose(form({ start: "22:00", durationMinutes: 120 }), NOW)).toMatchObject({
      ok: true,
    });
    expect(validatePropose(form({ date: "2027-02-30" }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ start: "25:00" }), NOW)).toMatchObject({ ok: false });
  });

  it("le jour du passage à l'heure avancée, 2 h 30 devient 3 h 30", () => {
    const r = validatePropose(
      form({ date: "2027-03-14", start: "02:30", durationMinutes: 60 }),
      NOW,
    );
    expect(r.ok && r.value.startsAt).toBe("2027-03-14T07:30:00.000Z");
  });

  it("refuse un identifiant de groupe ou de lieu invalide", () => {
    expect(validatePropose(form({ groupId: "x" }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(form({ placeId: "x" }), NOW)).toMatchObject({ ok: false });
    expect(validatePropose(null, NOW)).toMatchObject({ ok: false });
  });
});

describe("draftFromSlot et defaultFreeSlot", () => {
  it("reprend le jour et l'heure locaux d'une carte, durée bornée à 12 h", () => {
    expect(draftFromSlot("2027-03-16T22:00:00.000Z", 90)).toEqual({
      date: "2027-03-16",
      start: "18:00",
      durationMinutes: 90,
    });
    expect(draftFromSlot("2027-03-16T12:00:00.000Z", 840).durationMinutes).toBe(720);
  });

  it("propose la prochaine heure pleine, ou demain 18 h s'il est tard", () => {
    expect(defaultFreeSlot(NOW)).toEqual({ date: "2027-03-10", start: "11:00" });
    expect(defaultFreeSlot(new Date("2027-03-11T02:30:00Z"))).toEqual({
      date: "2027-03-11",
      start: "18:00",
    });
  });
});

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1",
  group_id: G,
  title: "Souper",
  location: "",
  place_id: null,
  starts_at: "2027-03-16T22:00:00Z",
  ends_at: "2027-03-17T00:00:00Z",
  status: "proposed",
  created_by: A,
  created_at: "2027-03-10T14:00:00Z",
  ...over,
});

const ctx = (myId: string) => ({
  myId,
  now: NOW,
  names: new Map([
    [A, "Ali"],
    [B, "Sam"],
    [C, "Zoé"],
  ]),
  groupNames: new Map([[G, "Gang"]]),
  placeNames: new Map([["lieu", "Café Olimpico"]]),
  groupMembers: new Map([[G, [A, B, C]]]),
});

describe("buildPlanViews / groupPlans", () => {
  const invitees = [A, B, C].map((u) => ({ plan_id: "p1", user_id: u }));
  const votes = [
    { plan_id: "p1", user_id: A, vote: "yes" as const },
    { plan_id: "p1", user_id: C, vote: "no" as const },
  ];

  it("met en forme : jour, heures, réponses, tout le groupe", () => {
    const [v] = buildPlanViews([plan()], invitees, votes, ctx(B));
    expect(v).toMatchObject({
      title: "Souper",
      dayLabel: "mardi 16 mars",
      timeLabel: "18 h – 20 h",
      where: "Lieu à préciser",
      creatorName: "Ali",
      isMine: false,
      invited: true,
      myResponse: null,
      state: "upcoming",
      accepted: ["Ali"],
      declined: ["Zoé"],
      waiting: ["Sam"],
      wholeGroup: true,
    });
    expect(isAwaitingMe(v)).toBe(true);
  });

  it("lieu enregistré ou écrit, titre de secours, annulé, passé", () => {
    const [v1] = buildPlanViews([plan({ place_id: "lieu", title: "" })], [], [], ctx(B));
    expect(v1.where).toBe("Café Olimpico");
    expect(v1.title).toBe("Plan de groupe");
    expect(v1.invited).toBe(false);
    expect(v1.wholeGroup).toBe(false);
    const [v2] = buildPlanViews([plan({ location: "Chez Sam" })], [], [], ctx(B));
    expect(v2.where).toBe("Chez Sam");
    const [minuit] = buildPlanViews([plan({ ends_at: "2027-03-17T04:00:00Z" })], [], [], ctx(B));
    expect(minuit.timeLabel).toBe("18 h – minuit");
    const [v3] = buildPlanViews([plan({ status: "cancelled" })], invitees, [], ctx(B));
    expect(v3.state).toBe("cancelled");
    const [v4] = buildPlanViews(
      [plan({ starts_at: "2027-03-01T22:00:00Z", ends_at: "2027-03-01T23:00:00Z" })],
      invitees,
      [],
      ctx(B),
    );
    expect(v4.state).toBe("past");
  });

  it("répartit : en attente, à venir, autres, passés", () => {
    const plans = [
      plan({ id: "attente" }),
      plan({ id: "accepte" }),
      plan({ id: "mien", created_by: B }),
      plan({ id: "refuse" }),
      plan({ id: "pas-invite" }),
      plan({ id: "annule", status: "cancelled" }),
    ];
    const inv = ["attente", "accepte", "mien", "refuse", "annule"].map((id) => ({
      plan_id: id,
      user_id: B,
    }));
    const vts = [
      { plan_id: "accepte", user_id: B, vote: "yes" as const },
      { plan_id: "mien", user_id: B, vote: "yes" as const },
      { plan_id: "refuse", user_id: B, vote: "no" as const },
    ];
    const g = groupPlans(buildPlanViews(plans, inv, vts, ctx(B)));
    expect(g.awaiting.map((p) => p.id)).toEqual(["attente"]);
    expect(g.upcoming.map((p) => p.id)).toEqual(["accepte", "mien"]);
    expect(g.others.map((p) => p.id)).toEqual(["refuse", "pas-invite"]);
    expect(g.past.map((p) => p.id)).toEqual(["annule"]);
  });

  it("countAwaiting : invitations proposées, à venir, sans réponse, pas les miennes", () => {
    const inv = [
      { plan_id: "a", created_by: A, status: "proposed", ends_at: "2027-03-17T00:00:00Z" },
      { plan_id: "b", created_by: A, status: "proposed", ends_at: "2027-03-17T00:00:00Z" },
      { plan_id: "c", created_by: B, status: "proposed", ends_at: "2027-03-17T00:00:00Z" },
      { plan_id: "d", created_by: A, status: "cancelled", ends_at: "2027-03-17T00:00:00Z" },
      { plan_id: "e", created_by: A, status: "proposed", ends_at: "2027-03-01T00:00:00Z" },
    ];
    expect(countAwaiting(inv, [{ plan_id: "b" }], B, NOW)).toBe(1);
  });
});

describe("buildPlanIcs", () => {
  it("produit un VEVENT en UTC, texte échappé, lignes en CRLF de 75 octets au plus", () => {
    const ics = buildPlanIcs(
      {
        id: "p1",
        title: "Souper; chez Sam, enfin",
        where: "Café Olimpico, Montréal",
        groupName: "Gang".repeat(30),
        startsAt: "2027-03-16T22:00:00Z",
        endsAt: "2027-03-17T00:00:00Z",
      },
      NOW,
      "https://exemple.ca/plans",
    );
    expect(ics).toContain("DTSTART:20270316T220000Z\r\n");
    expect(ics).toContain("DTEND:20270317T000000Z\r\n");
    expect(ics).toContain("SUMMARY:Souper\\; chez Sam\\, enfin\r\n");
    expect(ics).toContain("UID:plan-p1@temps-libre-commun\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(escapeIcsText("a\\b\nc")).toBe("a\\\\b\\nc");
  });
});

describe("buildPlanIcs : titre piégé (revue)", () => {
  it("un « \\r » seul ou un caractère de contrôle n'ajoute aucune ligne au fichier", () => {
    const ics = buildPlanIcs(
      {
        id: "11111111-2222-4333-8444-555555555555",
        title: "Souper\rBEGIN:VALARM\rTRIGGER:-PT1M\rEND:VALARM",
        where: "Parc\u0007\u001b Lafontaine",
        groupName: "Gang",
        startsAt: "2027-03-16T22:00:00.000Z",
        endsAt: "2027-03-17T00:00:00.000Z",
      },
      new Date("2027-03-01T12:00:00Z"),
    );
    const lines = ics.split("\r\n").filter((l) => l !== "");
    expect(lines.filter((l) => !l.startsWith(" ")).map((l) => l.split(":")[0])).toEqual([
      "BEGIN",
      "VERSION",
      "PRODID",
      "CALSCALE",
      "METHOD",
      "BEGIN",
      "UID",
      "DTSTAMP",
      "DTSTART",
      "DTEND",
      "SUMMARY",
      "LOCATION",
      "DESCRIPTION",
      "END",
      "END",
    ]);
    expect(ics).not.toMatch(/[\r](?!\n)/);
    expect(ics).toContain("SUMMARY:Souper\\nBEGIN:VALARM\\nTRIGGER:-PT1M\\nEND:VALARM");
    expect(ics).toContain("LOCATION:Parc Lafontaine");
  });

  it("un titre normal est écrit comme avant", () => {
    expect(escapeIcsText("Souper chez « Léo », 18 h; dessert\nà apporter")).toBe(
      "Souper chez « Léo »\\, 18 h\\; dessert\\nà apporter",
    );
  });
});
