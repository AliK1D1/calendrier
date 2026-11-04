import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getOutlookConfig } from "./config";
import type { OutlookDeps } from "./service";
import { supabaseOutlookStore } from "./supabaseStore";

/** Nom du cookie (chiffré) qui garde l'état OAuth pendant l'aller-retour chez Microsoft. */
export const OAUTH_COOKIE = "outlook_oauth";
/** Chemin du cookie : seulement les routes du connecteur. */
export const OAUTH_COOKIE_PATH = "/api/outlook";

/** Adresse de retour à inscrire dans Azure (« Redirect URI »). */
export const callbackUrl = (origin: string) => `${origin}/api/outlook/callback`;

/** Dépendances réelles du service (`null` si Outlook n'est pas configuré). */
export function outlookDeps(supabase: SupabaseClient, userId: string): OutlookDeps | null {
  const config = getOutlookConfig();
  if (!config) return null;
  return {
    store: supabaseOutlookStore(supabase, userId),
    config,
    fetch: (input, init) => fetch(input, init),
    userId,
    now: () => new Date(),
  };
}
