import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimResult, OutlookStore } from "./service";

/** Erreur de BD → exception (le service la transforme en message en français). */
function check(context: string, error: { code?: string; message: string } | null): void {
  if (error) throw new Error(`${context} : ${error.code ?? ""} ${error.message}`);
}

/**
 * `OutlookStore` sur Supabase, avec le client de la requête : tout passe par la RLS et les
 * fonctions de la migration 0014, au nom de la personne connectée (jamais `service_role`).
 */
export function supabaseOutlookStore(supabase: SupabaseClient, userId: string): OutlookStore {
  const table = () => supabase.from("outlook_connections");
  return {
    async claimSync(minMinutes) {
      const { data, error } = await supabase.rpc("claim_outlook_sync", {
        p_min_minutes: minMinutes,
      });
      check("Outlook (réservation)", error);
      const r = (data ?? {}) as Record<string, unknown>;
      if (r.status === "ok" && typeof r.refresh_token_enc === "string") {
        return {
          status: "ok",
          refreshTokenEnc: r.refresh_token_enc,
          calendarId: typeof r.calendar_id === "string" ? r.calendar_id : null,
        };
      }
      const status = r.status === "recent" || r.status === "busy" ? r.status : "none";
      return { status } satisfies ClaimResult;
    },

    async readConnection() {
      const { data, error } = await table()
        .select("refresh_token_enc, calendar_id")
        .eq("owner_id", userId)
        .maybeSingle<{ refresh_token_enc: string; calendar_id: string | null }>();
      check("Outlook (lecture)", error);
      return data
        ? { refreshTokenEnc: data.refresh_token_enc, calendarId: data.calendar_id }
        : null;
    },

    async saveConnection({ accountEmail, refreshTokenEnc }) {
      // Reconnexion : on remplace le compte et on repart de zéro (calendrier principal, pas
      // de verrou ni d'erreur d'avant). Pas d'« upsert » : owner_id n'est pas modifiable.
      const { data, error } = await table()
        .update({
          account_email: accountEmail,
          refresh_token_enc: refreshTokenEnc,
          calendar_id: null,
          calendar_name: "",
          last_attempt_at: null,
          sync_started_at: null,
          last_sync_error: "",
        })
        .eq("owner_id", userId)
        .select("owner_id");
      check("Outlook (connexion)", error);
      if (data && data.length > 0) return;
      const { error: e2 } = await table().insert({
        owner_id: userId,
        account_email: accountEmail,
        refresh_token_enc: refreshTokenEnc,
      });
      check("Outlook (connexion)", e2);
    },

    async saveRefreshToken(refreshTokenEnc) {
      const { error } = await table()
        .update({ refresh_token_enc: refreshTokenEnc })
        .eq("owner_id", userId);
      check("Outlook (jeton)", error);
    },

    async setCalendar(calendarId, calendarName) {
      const { error } = await table()
        .update({ calendar_id: calendarId, calendar_name: calendarName, last_attempt_at: null })
        .eq("owner_id", userId);
      check("Outlook (calendrier)", error);
    },

    async replaceBlocks(blocks) {
      const { data, error } = await supabase.rpc("replace_outlook_blocks", { p_blocks: blocks });
      check("Outlook (blocs)", error);
      return typeof data === "number" ? data : blocks.length;
    },

    async finishSync(result) {
      const { error } = await table()
        .update(
          result.ok
            ? { sync_started_at: null, last_synced_at: result.at, last_sync_error: "" }
            : { sync_started_at: null, last_sync_error: result.error },
        )
        .eq("owner_id", userId);
      check("Outlook (fin)", error);
    },

    async disconnect() {
      const { error } = await supabase.rpc("disconnect_outlook");
      check("Outlook (déconnexion)", error);
    },
  };
}

/** Ce que la page Profil affiche de la connexion (jamais le jeton). */
export interface OutlookStatus {
  accountEmail: string;
  calendarName: string;
  lastSyncedAt: string | null;
  lastSyncError: string;
}

/**
 * État de la connexion Outlook de la personne : `null` si pas connectée, `"absent"` si la
 * table n'existe pas encore (migration 0014 non appliquée).
 */
export async function getOutlookStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutlookStatus | null | "absent"> {
  const { data, error } = await supabase
    .from("outlook_connections")
    .select("account_email, calendar_name, last_synced_at, last_sync_error")
    .eq("owner_id", userId)
    .maybeSingle<{
      account_email: string;
      calendar_name: string;
      last_synced_at: string | null;
      last_sync_error: string;
    }>();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "absent";
    throw new Error(`Lecture de la connexion Outlook : ${error.message}`);
  }
  if (!data) return null;
  return {
    accountEmail: data.account_email,
    calendarName: data.calendar_name,
    lastSyncedAt: data.last_synced_at,
    lastSyncError: data.last_sync_error,
  };
}
