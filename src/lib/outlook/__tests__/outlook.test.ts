import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";

import { readOutlookConfig, type OutlookConfig } from "../config";
import { decryptSecret, encryptSecret, refreshTokenAad } from "../crypto";
import { GRAPH_BASE, getBusyEvents, listCalendars, parseGraphUtc, toBusyEvent } from "../graph";
import {
  buildAuthorizeUrl,
  createOAuthState,
  type FetchLike,
  OAUTH_STATE_TTL_MS,
  OutlookError,
  pkceChallenge,
  refreshTokens,
  verifyOAuthState,
} from "../oauth";
import {
  chooseOutlookCalendar,
  type ClaimResult,
  completeOutlookConnection,
  listOutlookCalendars,
  OUTLOOK_TOKEN_REFRESHES_PER_MINUTE,
  type OutlookBlockRow,
  type OutlookDeps,
  type OutlookStore,
  syncOutlook,
} from "../service";

const KEY = randomBytes(32);
const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const CONFIG: OutlookConfig = {
  clientId: "client",
  clientSecret: "secret",
  tenant: "common",
  tokenKey: KEY,
};
const NOW = new Date("2026-11-04T14:00:00Z"); // mercredi 4 nov., 9 h à Toronto

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Faux réseau : chaque appel est noté ; `route` répond selon l'adresse. */
function fakeFetch(route: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return route(url, init);
  };
  return { fetch, calls };
}

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

describe("config", () => {
  it("demande les trois variables et une clé de 32 octets", () => {
    const key = randomBytes(32).toString("base64");
    expect(readOutlookConfig({})).toBeNull();
    expect(
      readOutlookConfig({ MICROSOFT_CLIENT_ID: "a", MICROSOFT_CLIENT_SECRET: "b" }),
    ).toBeNull();
    expect(
      readOutlookConfig({
        MICROSOFT_CLIENT_ID: "a",
        MICROSOFT_CLIENT_SECRET: "b",
        OUTLOOK_TOKEN_KEY: "court",
      }),
    ).toBeNull();
    const c = readOutlookConfig({
      MICROSOFT_CLIENT_ID: "a",
      MICROSOFT_CLIENT_SECRET: "b",
      OUTLOOK_TOKEN_KEY: key,
    });
    expect(c?.tenant).toBe("common");
    expect(c?.tokenKey.length).toBe(32);
    expect(
      readOutlookConfig({
        MICROSOFT_CLIENT_ID: "a",
        MICROSOFT_CLIENT_SECRET: "b",
        OUTLOOK_TOKEN_KEY: key,
        MICROSOFT_TENANT: "../evil",
      }),
    ).toBeNull();
  });
});

describe("crypto", () => {
  it("chiffre et déchiffre ; chaque chiffrement est différent", () => {
    const a = encryptSecret("jeton", KEY, refreshTokenAad(USER));
    const b = encryptSecret("jeton", KEY, refreshTokenAad(USER));
    expect(a).not.toBe(b);
    expect(a).not.toContain("jeton");
    expect(decryptSecret(a, KEY, refreshTokenAad(USER))).toBe("jeton");
  });

  it("refuse une autre clé, un autre propriétaire, ou un texte modifié", () => {
    const sealed = encryptSecret("jeton", KEY, refreshTokenAad(USER));
    expect(decryptSecret(sealed, randomBytes(32), refreshTokenAad(USER))).toBeNull();
    expect(decryptSecret(sealed, KEY, refreshTokenAad(OTHER))).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("autre chose").toString("base64url");
    expect(decryptSecret(parts.join("."), KEY, refreshTokenAad(USER))).toBeNull();
    expect(decryptSecret("n'importe quoi", KEY, refreshTokenAad(USER))).toBeNull();
  });
});

describe("OAuth", () => {
  it("adresse de connexion : PKCE S256, lecture seule, compte au choix", () => {
    const url = new URL(
      buildAuthorizeUrl(CONFIG, {
        redirectUri: "https://app.test/api/outlook/callback",
        state: "etat",
        codeChallenge: "defi",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("scope")).toBe("offline_access User.Read Calendars.Read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/outlook/callback");
    expect(url.searchParams.get("state")).toBe("etat");
    expect(url.toString()).not.toContain("secret");
  });

  it("l'état n'est accepté que pour le même state, la même personne, avant 10 min", () => {
    const st = createOAuthState(USER, KEY, NOW);
    expect(st.cookie).not.toContain(st.state);
    const ok = verifyOAuthState(st.cookie, st.state, USER, KEY, NOW);
    expect(ok).not.toBeNull();
    expect(pkceChallenge(ok!.codeVerifier)).toBe(st.codeChallenge);
    expect(verifyOAuthState(st.cookie, "autre", USER, KEY, NOW)).toBeNull();
    expect(verifyOAuthState(st.cookie, st.state, OTHER, KEY, NOW)).toBeNull();
    expect(verifyOAuthState(undefined, st.state, USER, KEY, NOW)).toBeNull();
    const late = new Date(NOW.getTime() + OAUTH_STATE_TTL_MS + 1);
    expect(verifyOAuthState(st.cookie, st.state, USER, KEY, late)).toBeNull();
  });

  it("rafraîchit le jeton (secret côté serveur) ; invalid_grant → reconnexion", async () => {
    const ok = fakeFetch(() => json({ access_token: "acces", refresh_token: "nouveau" }));
    expect(await refreshTokens(CONFIG, ok.fetch, "ancien")).toEqual({
      accessToken: "acces",
      refreshToken: "nouveau",
    });
    expect(ok.calls[0].url).toBe(TOKEN_URL);
    const body = new URLSearchParams(String(ok.calls[0].init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ancien");
    expect(body.get("client_secret")).toBe("secret");

    const revoked = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    await expect(refreshTokens(CONFIG, revoked.fetch, "x")).rejects.toMatchObject({
      kind: "reauth",
    });
    const down = fakeFetch(() => json({}, 503));
    await expect(refreshTokens(CONFIG, down.fetch, "x")).rejects.toMatchObject({
      kind: "unavailable",
    });
    const offline = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(refreshTokens(CONFIG, offline.fetch, "x")).rejects.toBeInstanceOf(OutlookError);
  });
});

describe("Graph", () => {
  it("lit les dates UTC de Graph", () => {
    expect(parseGraphUtc("2026-11-04T15:00:00.0000000")?.toISOString()).toBe(
      "2026-11-04T15:00:00.000Z",
    );
    expect(parseGraphUtc("2026-11-04T15:00:00")?.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(parseGraphUtc("demain")).toBeNull();
    expect(parseGraphUtc(42)).toBeNull();
  });

  it("garde les événements occupés, ignore libres, annulés et illisibles", () => {
    const ev = (extra: Record<string, unknown>) => ({
      showAs: "busy",
      isCancelled: false,
      isAllDay: false,
      start: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-04T16:00:00.0000000", timeZone: "UTC" },
      ...extra,
    });
    expect(toBusyEvent(ev({}))).toEqual({
      kind: "timed",
      start: new Date("2026-11-04T15:00:00Z"),
      end: new Date("2026-11-04T16:00:00Z"),
    });
    expect(toBusyEvent(ev({ showAs: "free" }))).toBeNull();
    expect(toBusyEvent(ev({ isCancelled: true }))).toBeNull();
    expect(
      toBusyEvent(
        ev({ start: { dateTime: "2026-11-04T15:00:00", timeZone: "Eastern Standard Time" } }),
      ),
    ).toBeNull();
    expect(toBusyEvent(ev({ end: null }))).toBeNull();
    expect(toBusyEvent("pas un objet")).toBeNull();
    expect(
      toBusyEvent(
        ev({
          isAllDay: true,
          start: { dateTime: "2026-11-10T00:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-11-12T00:00:00.0000000", timeZone: "UTC" },
        }),
      ),
    ).toEqual({ kind: "allDay", firstDay: "2026-11-10", lastDay: "2026-11-11" });
  });

  it("calendarView : demande seulement les heures, suit les pages de Graph", async () => {
    const page2 = `${GRAPH_BASE}/me/calendar/calendarView?$skip=200`;
    const net = fakeFetch((url) =>
      url === page2
        ? json({
            value: [
              {
                showAs: "oof",
                isAllDay: true,
                start: { dateTime: "2026-11-06T00:00:00" },
                end: { dateTime: "2026-11-07T00:00:00" },
              },
            ],
          })
        : json({
            value: [
              {
                showAs: "busy",
                start: { dateTime: "2026-11-04T15:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-11-04T16:00:00", timeZone: "UTC" },
              },
            ],
            "@odata.nextLink": page2,
          }),
    );
    const r = await getBusyEvents(net.fetch, "acces", null, {
      start: new Date("2026-11-02T05:00:00Z"),
      end: new Date("2026-12-28T05:00:00Z"),
    });
    expect(r.events).toHaveLength(2);
    expect(r.truncated).toBe(false);
    const first = new URL(net.calls[0].url);
    expect(first.pathname).toBe("/v1.0/me/calendar/calendarView");
    expect(first.searchParams.get("$select")).toBe("start,end,isAllDay,showAs,isCancelled");
    expect(first.searchParams.get("startDateTime")).toBe("2026-11-02T05:00:00.000Z");
    const headers = net.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer acces");
    expect(headers.Prefer).toBe('outlook.timezone="UTC"');
  });

  it("n'envoie jamais le jeton ailleurs que chez Graph (nextLink piégé)", async () => {
    const net = fakeFetch(() =>
      json({ value: [], "@odata.nextLink": "https://mechant.example/vol?x=1" }),
    );
    await expect(
      getBusyEvents(net.fetch, "acces", null, { start: NOW, end: NOW }),
    ).rejects.toBeInstanceOf(OutlookError);
    expect(net.calls).toHaveLength(1);
  });

  it("calendrier choisi : identifiant encodé dans l'adresse", async () => {
    const net = fakeFetch(() => json({ value: [] }));
    await getBusyEvents(net.fetch, "acces", "AAMk/x+y=", { start: NOW, end: NOW });
    expect(
      net.calls[0].url.startsWith(`${GRAPH_BASE}/me/calendars/AAMk%2Fx%2By%3D/calendarView?`),
    ).toBe(true);
  });

  it("liste les calendriers, le principal d'abord", async () => {
    const net = fakeFetch(() =>
      json({
        value: [
          { id: "b", name: "Travail", isDefaultCalendar: false },
          { id: "a", name: "Calendrier", isDefaultCalendar: true },
          { id: "", name: "vide" },
        ],
      }),
    );
    expect(await listCalendars(net.fetch, "acces")).toEqual([
      { id: "a", name: "Calendrier", isDefault: true },
      { id: "b", name: "Travail", isDefault: false },
    ]);
  });

  it("401 → reconnexion ; 404 → calendrier disparu", async () => {
    await expect(
      getBusyEvents(fakeFetch(() => json({}, 401)).fetch, "x", null, { start: NOW, end: NOW }),
    ).rejects.toMatchObject({ kind: "reauth" });
    await expect(
      getBusyEvents(fakeFetch(() => json({}, 404)).fetch, "x", "c", { start: NOW, end: NOW }),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
});

// ─── Service (faux magasin) ───────────────────────────────────────────────────────────────

class FakeStore implements OutlookStore {
  connection: {
    refreshTokenEnc: string;
    calendarId: string | null;
    calendarName: string;
    email: string;
  } | null = null;
  claim: ClaimResult["status"] | null = null;
  blocks: OutlookBlockRow[] = [];
  finished: ({ ok: true; at: string } | { ok: false; error: string })[] = [];
  claims: number[] = [];

  async claimSync(minMinutes: number): Promise<ClaimResult> {
    this.claims.push(minMinutes);
    if (!this.connection) return { status: "none" };
    if (this.claim && this.claim !== "ok") return { status: this.claim };
    return {
      status: "ok",
      refreshTokenEnc: this.connection.refreshTokenEnc,
      calendarId: this.connection.calendarId,
    };
  }
  async readConnection() {
    return this.connection;
  }
  async saveConnection(input: { accountEmail: string; refreshTokenEnc: string }) {
    this.connection = {
      refreshTokenEnc: input.refreshTokenEnc,
      calendarId: null,
      calendarName: "",
      email: input.accountEmail,
    };
  }
  async saveRefreshToken(enc: string) {
    this.connection!.refreshTokenEnc = enc;
  }
  async setCalendar(id: string | null, name: string) {
    this.connection!.calendarId = id;
    this.connection!.calendarName = name;
  }
  async replaceBlocks(rows: OutlookBlockRow[]) {
    this.blocks = rows;
    return rows.length;
  }
  async finishSync(r: { ok: true; at: string } | { ok: false; error: string }) {
    this.finished.push(r);
  }
  async disconnect() {
    this.connection = null;
    this.blocks = [];
  }
}

/** Microsoft simulé : jetons + un événement (mer. 10 h–11 h 30) + calendriers. */
function microsoft(options: { tokenError?: string; rotate?: boolean } = {}) {
  return fakeFetch((url) => {
    if (url === TOKEN_URL) {
      if (options.tokenError) return json({ error: options.tokenError }, 400);
      return json({
        access_token: "acces",
        refresh_token: options.rotate === false ? undefined : "tourne",
      });
    }
    if (url.startsWith(`${GRAPH_BASE}/me?`)) return json({ mail: "ali@outlook.com" });
    if (url.startsWith(`${GRAPH_BASE}/me/calendars?`)) {
      return json({
        value: [
          { id: "princ", name: "Calendrier", isDefaultCalendar: true },
          { id: "job", name: "Job", isDefaultCalendar: false },
        ],
      });
    }
    if (url.includes("/calendarView?")) {
      return json({
        value: [
          {
            showAs: "busy",
            start: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-11-04T16:30:00.0000000", timeZone: "UTC" },
          },
          {
            showAs: "free",
            start: { dateTime: "2026-11-05T15:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-11-05T16:00:00.0000000", timeZone: "UTC" },
          },
        ],
      });
    }
    return json({}, 404);
  });
}

function deps(store: FakeStore, net: ReturnType<typeof fakeFetch>): OutlookDeps {
  return { store, config: CONFIG, fetch: net.fetch, userId: USER, now: () => NOW };
}

function connected(store: FakeStore, token = "jeton-initial") {
  store.connection = {
    refreshTokenEnc: encryptSecret(token, KEY, refreshTokenAad(USER)),
    calendarId: null,
    calendarName: "",
    email: "ali@outlook.com",
  };
}

describe("syncOutlook", () => {
  it("remplace les blocs par les heures occupées (sans titre), note la réussite", async () => {
    const store = new FakeStore();
    connected(store);
    const net = microsoft();
    const r = await syncOutlook(deps(store, net), { manual: false });
    expect(r).toEqual({ status: "synced", blocks: 1, truncated: false });
    expect(store.blocks).toEqual([{ day: "2026-11-04", start: "10:00", end: "11:30" }]);
    expect(store.claims).toEqual([15]);
    expect(store.finished).toEqual([{ ok: true, at: NOW.toISOString() }]);
    // Plage demandée : lundi 2 nov. 0 h → lundi 28 déc. 0 h (heure de Toronto).
    const view = new URL(net.calls.find((c) => c.url.includes("calendarView"))!.url);
    expect(view.searchParams.get("startDateTime")).toBe("2026-11-02T05:00:00.000Z");
    expect(view.searchParams.get("endDateTime")).toBe("2026-12-28T05:00:00.000Z");
  });

  it("enregistre le nouveau jeton (chiffré) quand Microsoft le renouvelle", async () => {
    const store = new FakeStore();
    connected(store);
    await syncOutlook(deps(store, microsoft()), { manual: true });
    expect(store.claims).toEqual([1]);
    expect(store.connection!.refreshTokenEnc).not.toContain("tourne");
    expect(decryptSecret(store.connection!.refreshTokenEnc, KEY, refreshTokenAad(USER))).toBe(
      "tourne",
    );
  });

  it("pas connecté, trop tôt ou déjà en cours : rien n'est appelé", async () => {
    const store = new FakeStore();
    const net = microsoft();
    expect(await syncOutlook(deps(store, net), { manual: false })).toEqual({
      status: "skipped",
      reason: "none",
    });
    connected(store);
    store.claim = "recent";
    expect(await syncOutlook(deps(store, net), { manual: false })).toEqual({
      status: "skipped",
      reason: "recent",
    });
    expect(net.calls).toHaveLength(0);
  });

  it("accès retiré : erreur notée, blocs gardés, il faut reconnecter", async () => {
    const store = new FakeStore();
    connected(store);
    store.blocks = [{ day: "2026-11-04", start: "08:00", end: "09:00" }];
    const r = await syncOutlook(deps(store, microsoft({ tokenError: "invalid_grant" })), {
      manual: true,
    });
    expect(r).toMatchObject({ status: "error", reauth: true });
    expect(store.blocks).toHaveLength(1);
    expect(store.finished[0]).toMatchObject({ ok: false });
    expect((store.finished[0] as { error: string }).error).toMatch(/Reconnecte Outlook/);
  });

  it("jeton chiffré pour quelqu'un d'autre : refusé sans appeler Microsoft", async () => {
    const store = new FakeStore();
    store.connection = {
      refreshTokenEnc: encryptSecret("vole", KEY, refreshTokenAad(OTHER)),
      calendarId: null,
      calendarName: "",
      email: "",
    };
    const net = microsoft();
    const r = await syncOutlook(deps(store, net), { manual: true });
    expect(r).toMatchObject({ status: "error", reauth: true });
    expect(net.calls).toHaveLength(0);
  });
});

describe("connexion et choix du calendrier", () => {
  it("connexion : jeton chiffré, adresse du compte, première synchro", async () => {
    const store = new FakeStore();
    const net = microsoft({ rotate: true });
    const r = await completeOutlookConnection(deps(store, net), {
      code: "code",
      redirectUri: "https://app.test/api/outlook/callback",
      codeVerifier: "verif",
    });
    expect(r).toMatchObject({ ok: true, sync: { status: "synced", blocks: 1 } });
    expect(store.connection!.email).toBe("ali@outlook.com");
    const tokenCall = new URLSearchParams(String(net.calls[0].init.body));
    expect(tokenCall.get("grant_type")).toBe("authorization_code");
    expect(tokenCall.get("code_verifier")).toBe("verif");
  });

  it("connexion sans jeton de rafraîchissement : refusée", async () => {
    const store = new FakeStore();
    const r = await completeOutlookConnection(deps(store, microsoft({ rotate: false })), {
      code: "code",
      redirectUri: "https://app.test/cb",
      codeVerifier: "v",
    });
    expect(r.ok).toBe(false);
    expect(store.connection).toBeNull();
  });

  it("choisit un calendrier du compte seulement ; le principal est gardé comme « nul »", async () => {
    const store = new FakeStore();
    connected(store);
    expect(await chooseOutlookCalendar(deps(store, microsoft()), "inconnu")).toMatchObject({
      ok: false,
    });
    expect(store.connection!.calendarId).toBeNull();

    const net = microsoft();
    expect(await chooseOutlookCalendar(deps(store, net), "job")).toMatchObject({ ok: true });
    expect(store.connection).toMatchObject({ calendarId: "job", calendarName: "Job" });
    expect(
      net.calls.some((c) => c.url.startsWith(`${GRAPH_BASE}/me/calendars/job/calendarView?`)),
    ).toBe(true);

    await chooseOutlookCalendar(deps(store, microsoft()), "princ");
    expect(store.connection).toMatchObject({ calendarId: null, calendarName: "" });
  });
});

describe("revue Outlook 1 : appels à Microsoft limités par personne", () => {
  /** Dépendances avec une limite comme dans l'app (horloge réglable). */
  function limited(store: FakeStore, net: ReturnType<typeof fakeFetch>, clock: { t: number }) {
    const limiter = createKeyedLimiter({
      limit: OUTLOOK_TOKEN_REFRESHES_PER_MINUTE,
      windowMs: 60_000,
      now: () => clock.t,
    });
    return (userId = USER): OutlookDeps => ({ ...deps(store, net), userId, limiter });
  }
  const tokenCalls = (net: ReturnType<typeof fakeFetch>) =>
    net.calls.filter((c) => c.url === TOKEN_URL).length;

  it("la liste des calendriers en boucle : au plus 10 jetons par minute, puis ça repart", async () => {
    const store = new FakeStore();
    connected(store);
    const net = microsoft({ rotate: false });
    const clock = { t: 0 };
    const make = limited(store, net, clock);
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await listOutlookCalendars(make()));
    expect(tokenCalls(net)).toBe(OUTLOOK_TOKEN_REFRESHES_PER_MINUTE);
    expect(results.filter((r) => r.ok)).toHaveLength(OUTLOOK_TOKEN_REFRESHES_PER_MINUTE);
    expect(results.at(-1)).toEqual({
      ok: false,
      message: "Trop d'essais avec Outlook d'un coup. Attends une minute et réessaie.",
    });
    clock.t += 60_001;
    expect(await listOutlookCalendars(make())).toMatchObject({ ok: true });
  });

  it("synchro au-delà de la limite (délai de la BD contourné) : rien n'est appelé, blocs gardés", async () => {
    const store = new FakeStore();
    connected(store);
    store.blocks = [{ day: "2026-11-04", start: "08:00", end: "09:00" }];
    const net = microsoft({ rotate: false });
    const make = limited(store, net, { t: 0 });
    for (let i = 0; i < OUTLOOK_TOKEN_REFRESHES_PER_MINUTE; i++) {
      expect(await syncOutlook(make(), { manual: true })).toMatchObject({ status: "synced" });
    }
    const before = net.calls.length;
    store.blocks = [{ day: "2026-11-04", start: "08:00", end: "09:00" }];
    const r = await syncOutlook(make(), { manual: true });
    expect(r).toMatchObject({ status: "error", reauth: false });
    expect(net.calls.length).toBe(before);
    expect(store.blocks).toHaveLength(1);
    // Le verrou est retiré (finishSync), l'erreur est notée.
    expect(store.finished.at(-1)).toMatchObject({ ok: false });
    // Une autre personne (même processus, même limite) n'est pas touchée.
    const other = new FakeStore();
    other.connection = {
      refreshTokenEnc: encryptSecret("jeton-b", KEY, refreshTokenAad(OTHER)),
      calendarId: null,
      calendarName: "",
      email: "",
    };
    const otherDeps: OutlookDeps = { ...make(OTHER), store: other };
    expect(await syncOutlook(otherDeps, { manual: true })).toMatchObject({ status: "synced" });
  });
});
