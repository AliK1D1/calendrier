import { describe, expect, it } from "vitest";

import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";
import type { SubscriptionEventRow } from "@/lib/scheduling/subscriptions";

import { FeedError } from "../safeFetch";
import {
  addIcsSubscription,
  addOutlookSubscription,
  type ClaimedSubscription,
  type NewSubscription,
  type OutlookSource,
  outlookCandidates,
  readIcsFeed,
  type SubscriptionDeps,
  SubscriptionError,
  type SubscriptionStore,
  syncSubscriptions,
} from "../service";

const NOW = new Date("2026-11-05T13:30:00Z");

/** Calendrier F1 : tout marqué « disponible » (TRANSPARENT), comme beaucoup de calendriers publics. */
function f1(raceDay = "20261108", name = "Formula 1"): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `X-WR-CALNAME:${name}`,
    "BEGIN:VEVENT",
    "UID:race-1",
    `DTSTART:${raceDay}T170000Z`,
    `DTEND:${raceDay}T190000Z`,
    "SUMMARY:GP du Brésil",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:old",
    "DTSTART:20250301T170000Z",
    "DTEND:20250301T190000Z",
    "SUMMARY:Vieille course",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

interface Sub extends NewSubscription {
  id: string;
  rows: SubscriptionEventRow[];
  error: string;
  claimable: boolean;
}

function fakeStore(options: { replaceFails?: Error } = {}) {
  const subs = new Map<string, Sub>();
  let n = 0;
  const store: SubscriptionStore = {
    async claim(_min, id): Promise<ClaimedSubscription[]> {
      const due = [...subs.values()].filter((s) => s.claimable && (id === null || s.id === id));
      for (const s of due) s.claimable = false;
      return due.map((s) =>
        s.kind === "ics"
          ? { id: s.id, kind: "ics", url: s.url ?? "" }
          : { id: s.id, kind: "outlook", outlookCalendarId: s.outlookCalendarId ?? "" },
      );
    },
    async insert(sub) {
      if ([...subs.values()].some((s) => s.url !== null && s.url === sub.url)) {
        throw new SubscriptionError("Tu es déjà abonné à ce calendrier.");
      }
      const id = `s${++n}`;
      subs.set(id, { ...sub, id, rows: [], error: "", claimable: false });
      return id;
    },
    async replaceEvents(id, rows) {
      if (options.replaceFails) throw options.replaceFails;
      const s = subs.get(id);
      if (!s) throw new Error("introuvable");
      s.rows = rows;
      s.error = "";
      return rows.length;
    },
    async failSync(id, message) {
      const s = subs.get(id);
      if (s) s.error = message;
    },
    async setBusy(id, busy) {
      const s = subs.get(id);
      if (s) s.countsAsBusy = busy;
    },
    async remove(id) {
      subs.delete(id);
    },
    async outlookCalendarIds() {
      return [...subs.values()].flatMap((s) => (s.outlookCalendarId ? [s.outlookCalendarId] : []));
    },
  };
  return { store, subs };
}

function deps(
  store: SubscriptionStore,
  fetchText: (url: string) => Promise<string>,
  extra: Partial<SubscriptionDeps> = {},
): SubscriptionDeps {
  return { store, fetchText, outlook: null, userId: "u1", now: () => NOW, ...extra };
}

describe("lecture d'un calendrier abonné", () => {
  it("garde les événements « disponible » de la fenêtre, et le nom du calendrier", () => {
    const r = readIcsFeed(f1(), NOW);
    expect(r).toEqual({
      ok: true,
      name: "Formula 1",
      rows: [
        {
          title: "GP du Brésil",
          start: "12:00",
          end: "14:00",
          weekday: null,
          from: "2026-11-08",
          until: null,
        },
      ],
    });
  });

  it("un calendrier sans événement n'est pas une erreur ; un faux calendrier, oui", () => {
    expect(readIcsFeed("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", NOW)).toMatchObject({
      ok: true,
      rows: [],
    });
    expect(readIcsFeed("<html>Bonjour</html>", NOW)).toMatchObject({ ok: false });
  });
});

describe("ajout d'un calendrier par son lien", () => {
  it("vérifie le lien, télécharge, puis enregistre (nom tiré du fichier)", async () => {
    const { store, subs } = fakeStore();
    const urls: string[] = [];
    const r = await addIcsSubscription(
      deps(store, async (u) => {
        urls.push(u);
        return f1();
      }),
      { url: "webcal://ics.example.com/f1.ics", name: "", countsAsBusy: false },
    );
    expect(r).toEqual({ ok: true, id: "s1", events: 1 });
    expect(urls).toEqual(["https://ics.example.com/f1.ics"]);
    expect(subs.get("s1")).toMatchObject({
      kind: "ics",
      name: "Formula 1",
      url: "https://ics.example.com/f1.ics",
      countsAsBusy: false,
    });
  });

  it("n'ajoute rien si le lien est interne ou ne marche pas", async () => {
    const { store, subs } = fakeStore();
    let fetched = 0;
    const d = deps(store, async () => {
      fetched++;
      throw new FeedError("Ce lien ne fonctionne plus (calendrier introuvable).", "gone");
    });
    expect(
      await addIcsSubscription(d, { url: "http://169.254.169.254/", name: "", countsAsBusy: true }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/adresse interne/) });
    expect(fetched).toBe(0);
    expect(
      await addIcsSubscription(d, {
        url: "https://example.com/x.ics",
        name: "",
        countsAsBusy: true,
      }),
    ).toEqual({ ok: false, error: "Ce lien ne fonctionne plus (calendrier introuvable)." });
    expect(subs.size).toBe(0);
  });

  it("retire l'abonnement si ses événements sont refusés (ex. limite de blocs)", async () => {
    const { store, subs } = fakeStore({
      replaceFails: new SubscriptionError("Trop de blocs dans l'horaire (1000 au maximum)"),
    });
    const r = await addIcsSubscription(
      deps(store, async () => f1()),
      {
        url: "https://example.com/f1.ics",
        name: "F1",
        countsAsBusy: true,
      },
    );
    expect(r).toEqual({ ok: false, error: "Trop de blocs dans l'horaire (1000 au maximum)" });
    expect(subs.size).toBe(0);
  });

  it("limite les téléchargements par personne", async () => {
    const { store } = fakeStore();
    const d = deps(store, async () => f1(), {
      limiter: createKeyedLimiter({ limit: 1, windowMs: 60_000 }),
    });
    expect(
      await addIcsSubscription(d, {
        url: "https://a.example.com/1.ics",
        name: "",
        countsAsBusy: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await addIcsSubscription(d, {
        url: "https://b.example.com/2.ics",
        name: "",
        countsAsBusy: true,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Attends une minute/) });
  });
});

describe("synchronisation", () => {
  it("remplace par la nouvelle version (une course déplacée)", async () => {
    const { store, subs } = fakeStore();
    let day = "20261108";
    const d = deps(store, async () => f1(day));
    await addIcsSubscription(d, {
      url: "https://example.com/f1.ics",
      name: "",
      countsAsBusy: true,
    });
    day = "20261115";
    subs.get("s1")!.claimable = true;
    expect(await syncSubscriptions(d, { manual: false })).toEqual({
      synced: 1,
      failed: 0,
      error: null,
    });
    expect(subs.get("s1")!.rows.map((r) => r.from)).toEqual(["2026-11-15"]);
  });

  it("lien brisé : garde la dernière version connue et note l'erreur", async () => {
    const { store, subs } = fakeStore();
    let broken = false;
    const d = deps(store, async () => {
      if (broken)
        throw new FeedError("Ce lien ne fonctionne plus (calendrier introuvable).", "gone");
      return f1();
    });
    await addIcsSubscription(d, {
      url: "https://example.com/f1.ics",
      name: "",
      countsAsBusy: true,
    });
    broken = true;
    subs.get("s1")!.claimable = true;
    expect(await syncSubscriptions(d, { manual: true, id: "s1" })).toEqual({
      synced: 0,
      failed: 1,
      error: "Ce lien ne fonctionne plus (calendrier introuvable).",
    });
    expect(subs.get("s1")!.rows).toHaveLength(1);
    expect(subs.get("s1")!.error).toMatch(/ne fonctionne plus/);
  });

  it("une erreur inattendue donne un message général (le détail reste dans les journaux)", async () => {
    const { store, subs } = fakeStore();
    let fail = false;
    const d = deps(store, async () => {
      if (fail) throw new Error("ECONNRESET socket hang up");
      return f1();
    });
    await addIcsSubscription(d, {
      url: "https://example.com/f1.ics",
      name: "",
      countsAsBusy: true,
    });
    fail = true;
    subs.get("s1")!.claimable = true;
    const r = await syncSubscriptions(d, { manual: false });
    expect(r.error).toBe(
      "La synchronisation de ce calendrier n'a pas fonctionné. Réessaie plus tard.",
    );
  });

  it("rien de dû : rien à faire", async () => {
    const { store } = fakeStore();
    expect(
      await syncSubscriptions(
        deps(store, async () => f1()),
        { manual: false },
      ),
    ).toEqual({
      synced: 0,
      failed: 0,
      error: null,
    });
  });
});

describe("calendriers abonnés dans Outlook", () => {
  const calendars = [
    { id: "main", name: "Calendrier", isDefault: true, readOnly: false },
    { id: "work", name: "Travail", isDefault: false, readOnly: false },
    { id: "f1", name: "Formula 1", isDefault: false, readOnly: true },
  ];
  const outlook = (synced: string | null = null): OutlookSource => ({
    async calendars() {
      return calendars;
    },
    async syncedCalendarId() {
      return synced;
    },
    async events(calendarId) {
      expect(calendarId).toBe("f1");
      return {
        events: [
          {
            kind: "timed",
            start: new Date("2026-11-08T17:00:00Z"),
            end: new Date("2026-11-08T19:00:00Z"),
          },
        ],
        truncated: false,
      };
    },
  });

  it("propose les autres calendriers du compte, les abonnés d'abord", async () => {
    const { store } = fakeStore();
    const d = deps(store, async () => "", { outlook: outlook() });
    expect(await outlookCandidates(d)).toEqual({
      ok: true,
      calendars: [
        { id: "f1", name: "Formula 1", readOnly: true },
        { id: "work", name: "Travail", readOnly: false },
      ],
    });
    // Celui déjà lu par le connecteur Outlook n'est pas proposé.
    expect(
      await outlookCandidates(deps(store, async () => "", { outlook: outlook("work") })),
    ).toMatchObject({
      calendars: [{ id: "f1" }, { id: "main" }],
    });
  });

  it("ajoute un calendrier Outlook : événements au nom du calendrier", async () => {
    const { store, subs } = fakeStore();
    const d = deps(store, async () => "", { outlook: outlook() });
    expect(await addOutlookSubscription(d, { calendarId: "f1", countsAsBusy: false })).toEqual({
      ok: true,
      id: "s1",
      events: 1,
    });
    expect(subs.get("s1")).toMatchObject({
      kind: "outlook",
      name: "Formula 1",
      outlookCalendarId: "f1",
      rows: [{ title: "Formula 1", start: "12:00", end: "14:00", from: "2026-11-08" }],
    });
    expect(await outlookCandidates(d)).toMatchObject({ calendars: [{ id: "work" }] });
    expect(await addOutlookSubscription(d, { calendarId: "inconnu", countsAsBusy: false })).toEqual(
      {
        ok: false,
        error: "Calendrier introuvable dans ton compte Outlook.",
      },
    );
  });

  it("sans Outlook connecté : refusé", async () => {
    const { store } = fakeStore();
    expect(
      await addOutlookSubscription(
        deps(store, async () => ""),
        { calendarId: "f1", countsAsBusy: true },
      ),
    ).toMatchObject({ ok: false });
  });
});
