/**
 * Connexion à un compte Microsoft (OAuth 2.0, code d'autorisation + PKCE + secret client),
 * point de terminaison « common » : comptes personnels (Outlook.com, Hotmail, Live) ET
 * comptes travail/école (Microsoft 365). Le `fetch` est injecté (faux dans les tests).
 *
 * Permissions demandées, en **lecture seule** : `Calendars.Read` (calendriers), `User.Read`
 * (adresse du compte, pour l'afficher) et `offline_access` (jeton de rafraîchissement, pour
 * synchroniser sans redemander la connexion).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { OutlookConfig } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const OUTLOOK_SCOPES = "offline_access User.Read Calendars.Read";

/** Délai pour répondre à Microsoft (connexion) : 10 min. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

/** Délai maximal d'un appel à Microsoft. */
export const MICROSOFT_TIMEOUT_MS = 10_000;

/** Erreur Outlook. `reauth` : il faut reconnecter Outlook (accès retiré ou expiré). */
export class OutlookError extends Error {
  constructor(
    message: string,
    readonly kind: "reauth" | "unavailable" | "invalid",
  ) {
    super(message);
    this.name = "OutlookError";
  }
}

const authorityBase = (tenant: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

// ─── État OAuth (cookie) ──────────────────────────────────────────────────────────────────

/** Contenu du cookie (chiffré) pendant l'aller-retour chez Microsoft. */
interface OAuthStatePayload {
  /** `state` envoyé à Microsoft (contre la falsification de requête). */
  s: string;
  /** Vérificateur PKCE. */
  v: string;
  /** Utilisateur de l'app qui a commencé la connexion. */
  u: string;
  /** Expiration (ms depuis 1970). */
  e: number;
}

const STATE_AAD = "outlook-oauth-state";

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

/** Défi PKCE (S256) d'un vérificateur. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Nouvel état : valeur du cookie (chiffrée), `state` et défi PKCE à envoyer à Microsoft. */
export function createOAuthState(
  userId: string,
  key: Buffer,
  now: Date,
): { cookie: string; state: string; codeChallenge: string } {
  const payload: OAuthStatePayload = {
    s: random(32),
    v: random(48),
    u: userId,
    e: now.getTime() + OAUTH_STATE_TTL_MS,
  };
  return {
    cookie: encryptSecret(JSON.stringify(payload), key, STATE_AAD),
    state: payload.s,
    codeChallenge: pkceChallenge(payload.v),
  };
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Vérifie le retour de Microsoft : cookie lisible, pas expiré, même `state`, même utilisateur.
 * Renvoie le vérificateur PKCE, ou `null`.
 */
export function verifyOAuthState(
  cookie: string | undefined,
  returnedState: string | null,
  userId: string,
  key: Buffer,
  now: Date,
): { codeVerifier: string } | null {
  if (!cookie || !returnedState) return null;
  const json = decryptSecret(cookie, key, STATE_AAD);
  if (!json) return null;
  let p: unknown;
  try {
    p = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const { s, v, u, e } = p as Record<string, unknown>;
  if (typeof s !== "string" || typeof v !== "string" || typeof u !== "string") return null;
  if (typeof e !== "number" || now.getTime() > e) return null;
  if (!sameString(s, returnedState) || u !== userId) return null;
  return { codeVerifier: v };
}

// ─── Adresses et jetons ───────────────────────────────────────────────────────────────────

/** Adresse de la page de connexion Microsoft. */
export function buildAuthorizeUrl(
  config: Pick<OutlookConfig, "clientId" | "tenant">,
  params: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(`${authorityBase(config.tenant)}/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", OUTLOOK_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface MicrosoftTokens {
  accessToken: string;
  /** Nouveau jeton de rafraîchissement, s'il y en a un (Microsoft le renouvelle souvent). */
  refreshToken: string | null;
}

async function postToken(
  config: OutlookConfig,
  fetch: FetchLike,
  body: Record<string, string>,
): Promise<MicrosoftTokens> {
  let res: Response;
  try {
    res = await fetch(`${authorityBase(config.tenant)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: OUTLOOK_SCOPES,
        ...body,
      }).toString(),
      signal: AbortSignal.timeout(MICROSOFT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new OutlookError(
      "Microsoft ne répond pas. Réessaie dans quelques minutes.",
      "unavailable",
    );
  }
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) json = parsed as Record<string, unknown>;
  } catch {
    // Réponse illisible : traitée plus bas.
  }
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    // On journalise le code seulement : la description peut contenir des identifiants.
    console.error("Outlook : jeton refusé :", code);
    if (
      code === "invalid_grant" ||
      code === "interaction_required" ||
      code === "consent_required"
    ) {
      throw new OutlookError(
        "Ton accès à Outlook a expiré ou a été retiré. Reconnecte Outlook.",
        "reauth",
      );
    }
    if (res.status >= 500 || res.status === 429) {
      throw new OutlookError(
        "Microsoft ne répond pas. Réessaie dans quelques minutes.",
        "unavailable",
      );
    }
    throw new OutlookError("La connexion à Outlook n'a pas fonctionné.", "invalid");
  }
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new OutlookError("La connexion à Outlook n'a pas fonctionné.", "invalid");
  }
  const refresh = json.refresh_token;
  return {
    accessToken,
    refreshToken: typeof refresh === "string" && refresh.length > 0 ? refresh : null,
  };
}

/** Échange le code reçu au retour de Microsoft contre des jetons. */
export function exchangeCode(
  config: OutlookConfig,
  fetch: FetchLike,
  params: { code: string; redirectUri: string; codeVerifier: string },
): Promise<MicrosoftTokens> {
  return postToken(config, fetch, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

/** Nouveau jeton d'accès (1 h) à partir du jeton de rafraîchissement. */
export function refreshTokens(
  config: OutlookConfig,
  fetch: FetchLike,
  refreshToken: string,
): Promise<MicrosoftTokens> {
  return postToken(config, fetch, { grant_type: "refresh_token", refresh_token: refreshToken });
}
