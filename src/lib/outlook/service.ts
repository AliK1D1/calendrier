/**
 * Connecteur Outlook : connexion, synchronisation, choix du calendrier. Aucun accès BD direct
 * ici : tout passe par un `OutlookStore` injecté (Supabase dans l'app, faux magasin dans les
 * tests), le réseau par un `fetch` injecté, l'heure par `now`.
 *
 * Synchronisation : on lit les 8 semaines à venir (à partir du lundi de la semaine en cours)
 * et on **remplace** tous les blocs Outlook de la personne par des blocs « Outlook » sans
 * titre ni lieu. Déclenchée automatiquement (au plus aux 15 min, quand la personne a l'app
 * ouverte) ou par le bouton « Actualiser » (au plus une fois par minute).
 */
import {
  OUTLOOK_AUTO_SYNC_MINUTES,
  OUTLOOK_MANUAL_SYNC_MINUTES,
  outlookEventsToDayPieces,
  outlookSyncRange,
  rangeInstants,
} from "@/lib/scheduling/outlookBusy";
import { formatClock } from "@/lib/scheduling/weeklyBlocks";

import type { OutlookConfig } from "./config";
import { decryptSecret, encryptSecret, refreshTokenAad } from "./crypto";
import { getAccountEmail, getBusyEvents, listCalendars, type OutlookCalendar } from "./graph";
import { exchangeCode, type FetchLike, OutlookError, refreshTokens } from "./oauth";

/** Bloc envoyé à `replace_outlook_blocks`. */
export interface OutlookBlockRow {
  day: string;
  start: string;
  end: string;
}

export type ClaimResult =
  | { status: "none" | "recent" | "busy" }
  | { status: "ok"; refreshTokenEnc: string; calendarId: string | null };

/** Accès à la BD, au nom de la personne connectée (RLS). */
export interface OutlookStore {
  /** Réserve une synchronisation si le dernier essai date d'au moins `minMinutes`. */
  claimSync(minMinutes: number): Promise<ClaimResult>;
  /** Jeton chiffré et calendrier choisi, sans réserver (`null` : pas connecté). */
  readConnection(): Promise<{ refreshTokenEnc: string; calendarId: string | null } | null>;
  /** Crée ou remplace la connexion (nouveau compte : calendrier principal, jamais synchronisé). */
  saveConnection(input: { accountEmail: string; refreshTokenEnc: string }): Promise<void>;
  saveRefreshToken(refreshTokenEnc: string): Promise<void>;
  /** Change de calendrier et rend la prochaine synchronisation possible tout de suite. */
  setCalendar(calendarId: string | null, calendarName: string): Promise<void>;
  /** Remplace tous les blocs Outlook (une transaction). */
  replaceBlocks(blocks: OutlookBlockRow[]): Promise<number>;
  /** Fin d'une synchronisation : retire le verrou, note le résultat. */
  finishSync(result: { ok: true; at: string } | { ok: false; error: string }): Promise<void>;
  /** Retire la connexion et tous les blocs Outlook. */
  disconnect(): Promise<void>;
}

export interface OutlookDeps {
  store: OutlookStore;
  config: OutlookConfig;
  fetch: FetchLike;
  userId: string;
  now: () => Date;
}

export type SyncOutcome =
  | { status: "synced"; blocks: number; truncated: boolean }
  | { status: "skipped"; reason: "none" | "recent" | "busy" }
  | { status: "error"; message: string; reauth: boolean };

const GENERIC_ERROR = "La synchronisation avec Outlook n'a pas fonctionné. Réessaie plus tard.";

function errorOutcome(e: unknown): { status: "error"; message: string; reauth: boolean } {
  if (e instanceof OutlookError) {
    return { status: "error", message: e.message.slice(0, 300), reauth: e.kind === "reauth" };
  }
  console.error("Outlook : synchronisation :", e instanceof Error ? e.message : e);
  return { status: "error", message: GENERIC_ERROR, reauth: false };
}

/** Jeton d'accès frais ; enregistre le nouveau jeton de rafraîchissement s'il a changé. */
async function accessTokenFrom(deps: OutlookDeps, refreshTokenEnc: string): Promise<string> {
  const refresh = decryptSecret(
    refreshTokenEnc,
    deps.config.tokenKey,
    refreshTokenAad(deps.userId),
  );
  if (!refresh) {
    // Clé changée, ou valeur écrite à la main : il faut se reconnecter.
    throw new OutlookError("Reconnecte Outlook pour reprendre la synchronisation.", "reauth");
  }
  const tokens = await refreshTokens(deps.config, deps.fetch, refresh);
  if (tokens.refreshToken && tokens.refreshToken !== refresh) {
    await deps.store.saveRefreshToken(
      encryptSecret(tokens.refreshToken, deps.config.tokenKey, refreshTokenAad(deps.userId)),
    );
  }
  return tokens.accessToken;
}

/** Lit Outlook et remplace les blocs. Suppose la synchronisation réservée. */
async function pullAndReplace(
  deps: OutlookDeps,
  accessToken: string,
  calendarId: string | null,
): Promise<{ blocks: number; truncated: boolean }> {
  const range = outlookSyncRange(deps.now());
  const { events, truncated: tooManyPages } = await getBusyEvents(
    deps.fetch,
    accessToken,
    calendarId,
    rangeInstants(range),
  );
  const { pieces, truncated } = outlookEventsToDayPieces(events, range);
  const rows = pieces.map((p) => ({
    day: p.day,
    start: formatClock(p.startMinute),
    end: formatClock(p.endMinute),
  }));
  const blocks = await deps.store.replaceBlocks(rows);
  return { blocks, truncated: truncated || tooManyPages };
}

/**
 * Synchronise si c'est le moment : `manual` (bouton) → au plus une fois par minute ; sinon
 * au plus aux 15 min. Ne lève jamais d'erreur : le résultat dit ce qui s'est passé, et
 * l'erreur est aussi notée dans la BD (affichée dans Profil).
 */
export async function syncOutlook(
  deps: OutlookDeps,
  options: { manual: boolean },
): Promise<SyncOutcome> {
  let claim: ClaimResult;
  try {
    claim = await deps.store.claimSync(
      options.manual ? OUTLOOK_MANUAL_SYNC_MINUTES : OUTLOOK_AUTO_SYNC_MINUTES,
    );
  } catch (e) {
    return errorOutcome(e);
  }
  if (claim.status !== "ok") return { status: "skipped", reason: claim.status };

  try {
    const accessToken = await accessTokenFrom(deps, claim.refreshTokenEnc);
    const r = await pullAndReplace(deps, accessToken, claim.calendarId);
    await deps.store.finishSync({ ok: true, at: deps.now().toISOString() });
    return { status: "synced", ...r };
  } catch (e) {
    const out = errorOutcome(e);
    await deps.store.finishSync({ ok: false, error: out.message }).catch((err: unknown) => {
      console.error("Outlook : fin de synchronisation :", err instanceof Error ? err.message : err);
    });
    return out;
  }
}

/**
 * Fin de la connexion (retour de Microsoft) : échange le code, enregistre le jeton chiffré et
 * l'adresse du compte, puis fait une première synchronisation.
 */
export async function completeOutlookConnection(
  deps: OutlookDeps,
  params: { code: string; redirectUri: string; codeVerifier: string },
): Promise<{ ok: true; sync: SyncOutcome } | { ok: false; message: string }> {
  try {
    const tokens = await exchangeCode(deps.config, deps.fetch, params);
    if (!tokens.refreshToken) {
      return { ok: false, message: "Microsoft n'a pas donné l'accès hors ligne. Réessaie." };
    }
    const accountEmail = await getAccountEmail(deps.fetch, tokens.accessToken).catch(() => "");
    await deps.store.saveConnection({
      accountEmail,
      refreshTokenEnc: encryptSecret(
        tokens.refreshToken,
        deps.config.tokenKey,
        refreshTokenAad(deps.userId),
      ),
    });
  } catch (e) {
    const out = errorOutcome(e);
    return { ok: false, message: out.message };
  }
  return { ok: true, sync: await syncOutlook(deps, { manual: true }) };
}

/** Calendriers du compte connecté, pour le choix du calendrier. */
export async function listOutlookCalendars(
  deps: OutlookDeps,
): Promise<
  | { ok: true; calendars: OutlookCalendar[]; current: string | null }
  | { ok: false; message: string }
> {
  try {
    const conn = await deps.store.readConnection();
    if (!conn) return { ok: false, message: "Outlook n'est pas connecté." };
    const accessToken = await accessTokenFrom(deps, conn.refreshTokenEnc);
    return {
      ok: true,
      calendars: await listCalendars(deps.fetch, accessToken),
      current: conn.calendarId,
    };
  } catch (e) {
    return { ok: false, message: errorOutcome(e).message };
  }
}

/**
 * Choisit le calendrier lu (`null` : le principal). L'identifiant doit être un calendrier du
 * compte (vérifié auprès d'Outlook). Synchronise tout de suite avec le nouveau calendrier.
 */
export async function chooseOutlookCalendar(
  deps: OutlookDeps,
  calendarId: string | null,
): Promise<{ ok: true; sync: SyncOutcome } | { ok: false; message: string }> {
  const list = await listOutlookCalendars(deps);
  if (!list.ok) return list;
  let name = "";
  let id: string | null = null;
  if (calendarId !== null) {
    const found = list.calendars.find((c) => c.id === calendarId);
    if (!found) return { ok: false, message: "Calendrier introuvable dans ton compte Outlook." };
    // Le principal est enregistré comme « nul » : il suit le compte s'il change.
    if (!found.isDefault) {
      id = found.id;
      name = found.name;
    }
  }
  try {
    await deps.store.setCalendar(id, name);
  } catch (e) {
    return { ok: false, message: errorOutcome(e).message };
  }
  return { ok: true, sync: await syncOutlook(deps, { manual: true }) };
}
