import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";

/**
 * Client Supabase côté serveur (composants serveur, actions, routes), lié aux cookies de la
 * requête : les requêtes passent par RLS au nom de l'utilisateur connecté.
 * Renvoie `null` si Supabase n'est pas configuré. Créer un client par requête.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un composant serveur (cookies en lecture seule) : sans effet, le
          // middleware rafraîchit déjà la session.
        }
      },
    },
  });
}

/** Utilisateur connecté (vérifié auprès de Supabase Auth), ou `null`. */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}
