"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dbErrorMessage, requireUser } from "@/lib/actions";
import type { BusyBlockInput, PlaceInput, ProfileInput } from "@/lib/db/convert";
import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";
import type { Result } from "@/lib/places/validation";
import {
  type MeetupSearchView,
  type MeetupStore,
  searchGroupMeetups,
  validateMeetupSearch,
} from "@/lib/meetups/search";
import { getTravelProvider } from "@/lib/travel/server";

/** Recherches par minute et par personne : le calcul occupe le serveur (revue de sécurité). */
const RECHERCHES_PAR_MINUTE = 20;
const rechercheLimiter = createKeyedLimiter({ limit: RECHERCHES_PAR_MINUTE, windowMs: 60_000 });

/**
 * Lectures Supabase de « Quand on peut se voir », au nom de la personne connectée (jeton de
 * sa session : la RLS s'applique). Jamais de clé service.
 */
function supabaseMeetupStore(supabase: SupabaseClient): MeetupStore {
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
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, display_name, travel_mode, home_place_id, unavailable_before, unavailable_after",
        )
        .in("id", ids)
        .returns<ProfileInput[]>();
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
  };
}

/** Cherche les moments réalistes pour les participants choisis d'un groupe. */
export async function chercherMoments(raw: unknown): Promise<Result<MeetupSearchView>> {
  const input = validateMeetupSearch(raw);
  if (!input.ok) return input;
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!rechercheLimiter.tryAcquire(ctx.user.id)) {
    return { ok: false, error: "Trop de recherches d'un coup. Attends une minute et réessaie." };
  }
  try {
    return await searchGroupMeetups(supabaseMeetupStore(ctx.supabase), input.value, {
      userId: ctx.user.id,
      now: new Date(),
      travel: getTravelProvider(),
    });
  } catch (e) {
    console.error("Moments :", e);
    return { ok: false, error: "Le calcul n'a pas fonctionné. Réessaie." };
  }
}
