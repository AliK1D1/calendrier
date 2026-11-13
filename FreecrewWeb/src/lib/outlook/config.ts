/**
 * Configuration du connecteur Outlook (côté serveur SEULEMENT : aucune de ces variables n'a
 * le préfixe NEXT_PUBLIC_, Next.js ne les envoie jamais au navigateur).
 *
 * - `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` : inscription d'app Azure (Microsoft
 *   Entra ID), comptes personnels ET travail/école.
 * - `OUTLOOK_TOKEN_KEY` : 32 octets aléatoires en base64, pour chiffrer les jetons Microsoft
 *   avant de les écrire dans la BD.
 * - `MICROSOFT_TENANT` (facultatif) : « common » par défaut (tous les types de comptes).
 *
 * S'il manque quelque chose, `null` : l'app marche comme avant, le bouton « Connecter
 * Outlook » explique que ce n'est pas encore configuré.
 */
export interface OutlookEnv {
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT?: string;
  OUTLOOK_TOKEN_KEY?: string;
}

export interface OutlookConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  /** Clé AES-256 (32 octets). */
  tokenKey: Buffer;
}

const TENANT_RE = /^[A-Za-z0-9.-]{1,100}$/;

/** Lit la configuration ; `null` si incomplète ou invalide (détail dans les journaux). */
export function readOutlookConfig(env: OutlookEnv): OutlookConfig | null {
  const clientId = env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_CLIENT_SECRET?.trim();
  const rawKey = env.OUTLOOK_TOKEN_KEY?.trim();
  if (!clientId || !clientSecret || !rawKey) return null;
  const tenant = env.MICROSOFT_TENANT?.trim() || "common";
  if (!TENANT_RE.test(tenant)) {
    console.error("Outlook : MICROSOFT_TENANT invalide.");
    return null;
  }
  const tokenKey = Buffer.from(rawKey, "base64");
  if (tokenKey.length !== 32) {
    console.error("Outlook : OUTLOOK_TOKEN_KEY doit faire 32 octets en base64.");
    return null;
  }
  return { clientId, clientSecret, tenant, tokenKey };
}

/** Configuration tirée de `process.env`. */
export function getOutlookConfig(): OutlookConfig | null {
  return readOutlookConfig({
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT: process.env.MICROSOFT_TENANT,
    OUTLOOK_TOKEN_KEY: process.env.OUTLOOK_TOKEN_KEY,
  });
}
