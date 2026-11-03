import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dbErrorMessage } from "@/lib/actions";
import type {
  DeadlineInput,
  PlaceInput,
  ProfileInput,
  StudyBlockInput,
  StudyPreferencesInput,
} from "@/lib/db/convert";

import type { StudyStore } from "./service";

/** Lectures Supabase du planificateur, au nom de la personne connectée (RLS, jamais de clé service). */
export function supabaseStudyStore(supabase: SupabaseClient, userId: string): StudyStore {
  const fail = (context: string, error: { code?: string; message: string }) => ({
    ok: false as const,
    error: dbErrorMessage(context, error),
  });
  return {
    async profile() {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, display_name, travel_mode, home_place_id, unavailable_before, unavailable_after",
        )
        .eq("id", userId)
        .maybeSingle<ProfileInput>();
      if (error) return fail("Étude (profil)", error);
      return { ok: true, value: data };
    },
    async places() {
      const { data, error } = await supabase
        .from("places")
        .select("id, owner_id, name, lat, lng")
        .eq("owner_id", userId)
        .is("group_id", null)
        .returns<PlaceInput[]>();
      if (error) return fail("Étude (lieux)", error);
      return { ok: true, value: data ?? [] };
    },
    async placesByIds(ids) {
      const { data, error } = await supabase
        .from("places")
        .select("id, owner_id, name, lat, lng")
        .in("id", ids)
        .returns<PlaceInput[]>();
      if (error) return fail("Étude (lieux des plans)", error);
      return { ok: true, value: data ?? [] };
    },
    async blocks() {
      const { data, error } = await supabase
        .from("busy_blocks")
        .select(
          "id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, source, deadline_id, movable",
        )
        .eq("owner_id", userId)
        .returns<StudyBlockInput[]>();
      if (error) return fail("Étude (horaire)", error);
      return { ok: true, value: data ?? [] };
    },
    async deadlines() {
      const { data, error } = await supabase
        .from("deadlines")
        .select("id, kind, course, due_at, estimated_hours, difficulty")
        .eq("owner_id", userId)
        .order("due_at", { ascending: true })
        .returns<DeadlineInput[]>();
      if (error) return fail("Étude (échéances)", error);
      return { ok: true, value: data ?? [] };
    },
    async preferences() {
      const { data, error } = await supabase
        .from("study_preferences")
        .select(
          "min_session_minutes, max_session_minutes, max_minutes_per_day, break_minutes, study_start, study_end, eve_cutoff, keep_free_percent",
        )
        .eq("owner_id", userId)
        .maybeSingle<StudyPreferencesInput>();
      if (error) return fail("Étude (préférences)", error);
      return { ok: true, value: data };
    },
  };
}
