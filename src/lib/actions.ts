import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Résultat d'une action serveur, affiché tel quel dans l'interface. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const fail = (error: string): ActionResult => ({ ok: false, error });

/**
 * Client Supabase de la requête + utilisateur connecté (vérifié par Supabase Auth), ou un
 * message d'erreur. Toutes les écritures passent par ce client : la RLS s'applique.
 */
export async function requireUser(): Promise<
  { ok: true; supabase: SupabaseClient; user: User } | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "La base de données n'est pas configurée." };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Ta session a expiré. Reconnecte-toi." };
  return { ok: true, supabase, user: data.user };
}

/** Message français pour une erreur PostgREST/Postgres (détail technique dans les journaux). */
export function dbErrorMessage(context: string, error: { code?: string; message: string }): string {
  console.error(`${context} :`, error.code, error.message);
  if (error.code === "42501") return "Action non permise.";
  if (error.code === "23514") return "Valeur refusée par la base de données.";
  if (error.code === "PGRST202" || error.code === "42703" || error.code === "42883") {
    return "La base de données n'est pas à jour : applique supabase/migration-0003.sql (voir README).";
  }
  return "L'enregistrement n'a pas fonctionné. Réessaie.";
}
