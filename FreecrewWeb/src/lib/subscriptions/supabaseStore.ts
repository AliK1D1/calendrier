import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimedSubscription, SubscriptionStore } from "./service";
import { SubscriptionError } from "./service";

/** Erreur de BD → exception ; les limites (code 54000) ont déjà un message en français. */
function check(context: string, error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (error.code === "54000") throw new SubscriptionError(error.message);
  if (error.code === "23505") throw new SubscriptionError("Tu es déjà abonné à ce calendrier.");
  throw new Error(`${context} : ${error.code ?? ""} ${error.message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `SubscriptionStore` sur Supabase, avec le client de la requête : tout passe par la RLS et
 * les fonctions de la migration 0017, au nom de la personne connectée (jamais `service_role`).
 */
export function supabaseSubscriptionStore(
  supabase: SupabaseClient,
  userId: string,
): SubscriptionStore {
  return {
    async claim(minMinutes, id) {
      const { data, error } = await supabase.rpc("claim_subscription_syncs", {
        p_min_minutes: minMinutes,
        p_id: id,
      });
      check("Abonnements (réservation)", error);
      const out: ClaimedSubscription[] = [];
      for (const r of Array.isArray(data) ? (data as unknown[]) : []) {
        if (!isRecord(r) || typeof r.id !== "string") continue;
        if (r.kind === "ics" && typeof r.url === "string") {
          out.push({ id: r.id, kind: "ics", url: r.url });
        } else if (r.kind === "outlook" && typeof r.outlook_calendar_id === "string") {
          out.push({ id: r.id, kind: "outlook", outlookCalendarId: r.outlook_calendar_id });
        }
      }
      return out;
    },

    async insert(sub) {
      const { data, error } = await supabase
        .from("calendar_subscriptions")
        .insert({
          owner_id: userId,
          kind: sub.kind,
          name: sub.name,
          url: sub.url,
          outlook_calendar_id: sub.outlookCalendarId,
          counts_as_busy: sub.countsAsBusy,
        })
        .select("id")
        .single<{ id: string }>();
      check("Abonnements (ajout)", error);
      if (!data) throw new Error("Abonnements (ajout) : aucune ligne");
      return data.id;
    },

    async replaceEvents(id, rows) {
      const { data, error } = await supabase.rpc("replace_subscription_events", {
        p_id: id,
        p_events: rows,
      });
      check("Abonnements (événements)", error);
      return typeof data === "number" ? data : rows.length;
    },

    async failSync(id, message) {
      const { error } = await supabase.rpc("fail_subscription_sync", {
        p_id: id,
        p_error: message,
      });
      check("Abonnements (échec)", error);
    },

    async setBusy(id, busy) {
      const { error } = await supabase.rpc("set_subscription_busy", { p_id: id, p_busy: busy });
      check("Abonnements (occupé)", error);
    },

    async remove(id) {
      const { error } = await supabase
        .from("calendar_subscriptions")
        .delete()
        .eq("id", id)
        .eq("owner_id", userId);
      check("Abonnements (retrait)", error);
    },

    async outlookCalendarIds() {
      const { data, error } = await supabase
        .from("calendar_subscriptions")
        .select("outlook_calendar_id")
        .eq("owner_id", userId)
        .eq("kind", "outlook")
        .returns<{ outlook_calendar_id: string | null }[]>();
      check("Abonnements (Outlook)", error);
      return (data ?? []).flatMap((r) => (r.outlook_calendar_id ? [r.outlook_calendar_id] : []));
    },
  };
}

/** Ce que Profil affiche d'un abonnement (jamais l'adresse complète). */
export interface SubscriptionStatus {
  id: string;
  kind: "ics" | "outlook";
  name: string;
  /** Site du lien (« formula1.com »), ou « Outlook ». */
  source: string;
  countsAsBusy: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string;
}

/**
 * Abonnements de la personne : `"absent"` si la table n'existe pas encore (migration 0017 non
 * appliquée).
 */
export async function getMySubscriptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionStatus[] | "absent"> {
  const { data, error } = await supabase
    .from("calendar_subscriptions")
    .select("id, kind, name, url, counts_as_busy, last_synced_at, last_sync_error")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        kind: "ics" | "outlook";
        name: string;
        url: string | null;
        counts_as_busy: boolean;
        last_synced_at: string | null;
        last_sync_error: string;
      }[]
    >();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "absent";
    throw new Error(`Lecture des calendriers abonnés : ${error.message}`);
  }
  return (data ?? []).map((r) => {
    let source = "Outlook";
    if (r.kind === "ics" && r.url) {
      try {
        source = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        source = "lien";
      }
    }
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      source,
      countsAsBusy: r.counts_as_busy,
      lastSyncedAt: r.last_synced_at,
      lastSyncError: r.last_sync_error,
    };
  });
}

/** Événement d'un calendrier abonné, pour « Mon horaire ». */
export interface MySubscriptionEvent {
  id: string;
  subscription_id: string;
  title: string;
  start_time: string;
  end_time: string;
  weekday: number | null;
  valid_from: string;
  valid_until: string | null;
}

/** Événements de mes calendriers abonnés (vide si la migration 0017 manque). */
export async function getMySubscriptionEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<MySubscriptionEvent[]> {
  const { data, error } = await supabase
    .from("subscription_events")
    .select("id, subscription_id, title, start_time, end_time, weekday, valid_from, valid_until")
    .eq("owner_id", userId)
    .order("valid_from")
    .order("start_time")
    .returns<MySubscriptionEvent[]>();
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") {
      console.error("Calendriers abonnés (événements) :", error.code, error.message);
    }
    return [];
  }
  return data ?? [];
}
