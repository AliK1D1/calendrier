import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dbErrorMessage } from "@/lib/actions";
import type {
  AvailabilitySlotInput,
  BusyBlockInput,
  PlaceInput,
  ProfileInput,
} from "@/lib/db/convert";

import type { FreeNowStore } from "./freeNow";
import type { MeetupStore } from "./search";

/**
 * Lectures Supabase de « Quand on peut se voir », au nom de la personne connectée (jeton de
 * sa session : la RLS s'applique). Jamais de clé service.
 */
export function supabaseMeetupStore(supabase: SupabaseClient): MeetupStore {
  const fail = (context: string, error: { code?: string; message: string }) => ({
    ok: false as const,
    error: dbErrorMessage(context, error),
  });
  return {
    async memberIds(groupId) {
      const { data, error } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .returns<{ user_id: string }[]>();
      if (error) return fail("Moments (membres)", error);
      return { ok: true, value: (data ?? []).map((m) => m.user_id) };
    },
    async profiles(ids) {
      const columns =
        "id, display_name, travel_mode, home_place_id, unavailable_before, unavailable_after";
      const read = (cols: string) =>
        supabase.from("profiles").select(cols).in("id", ids).returns<ProfileInput[]>();
      // Limite de sorties (migration 0022) : sans les colonnes, on lit comme avant.
      let { data, error } = await read(`${columns}, max_outings_per_day, max_outings_per_week`);
      if (error?.code === "42703") ({ data, error } = await read(columns));
      if (error) return fail("Moments (profils)", error);
      return { ok: true, value: data ?? [] };
    },
    async personalPlaces(ownerIds) {
      const { data, error } = await supabase
        .from("places")
        .select("id, owner_id, name, lat, lng")
        .in("owner_id", ownerIds)
        .is("group_id", null)
        .returns<PlaceInput[]>();
      if (error) return fail("Moments (lieux)", error);
      return { ok: true, value: data ?? [] };
    },
    async groupPlaces(groupId) {
      const { data, error } = await supabase
        .from("places")
        .select("id, owner_id, name, lat, lng")
        .eq("group_id", groupId)
        .returns<PlaceInput[]>();
      if (error) return fail("Moments (lieux du groupe)", error);
      return { ok: true, value: data ?? [] };
    },
    async groupBlocks(groupId) {
      const { data, error } = await supabase.rpc("group_busy_blocks", { gid: groupId });
      if (error) return fail("Moments (horaires)", error);
      // supabase-js sans types générés ne connaît pas la forme d'une fonction : on la précise.
      return { ok: true, value: (data ?? []) as unknown as BusyBlockInput[] };
    },
    async groupAvailabilities(groupId) {
      const { data, error } = await supabase.rpc("group_availability_slots", { gid: groupId });
      if (error) {
        // Base pas encore migrée (supabase/migration-0012.sql) : le calcul marche sans.
        if (error.code === "PGRST202" || error.code === "42883") {
          console.warn("Disponibilités ponctuelles : migration 0012 manquante.");
          return { ok: true, value: [] };
        }
        return fail("Moments (disponibilités)", error);
      }
      return { ok: true, value: (data ?? []) as unknown as AvailabilitySlotInput[] };
    },
  };
}

/** Magasin de « Je suis libre maintenant » : celui de la recherche, plus mes groupes. */
export function supabaseFreeNowStore(supabase: SupabaseClient): FreeNowStore {
  return {
    ...supabaseMeetupStore(supabase),
    async myGroups() {
      const { data, error } = await supabase
        .from("groups")
        .select("id, name")
        .order("created_at", { ascending: true })
        .returns<{ id: string; name: string }[]>();
      if (error) {
        return { ok: false, error: dbErrorMessage("Libre maintenant (groupes)", error) };
      }
      return { ok: true, value: data ?? [] };
    },
  };
}
