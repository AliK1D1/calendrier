import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type StudyPreferencesInput, toStudyPreferences } from "@/lib/db/convert";
import type { BusyBlockRow, PlaceRow, ProfileRow } from "@/lib/db/schema";
import type { StudyPreferences } from "@/lib/scheduling/types";

export type MyProfile = Pick<ProfileRow, "id" | "display_name" | "travel_mode" | "home_place_id">;
export type MyPlace = Pick<PlaceRow, "id" | "name" | "lat" | "lng">;

/**
 * Vrai si l'accueil de première connexion est fait, faux sinon, `null` si on ne peut pas le
 * savoir (pas connecté, ou colonne `onboarded_at` absente : migration 0003 pas appliquée).
 */
export async function getOnboardingStatus(supabase: SupabaseClient): Promise<boolean | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", auth.user.id)
    .maybeSingle<{ onboarded_at: string | null }>();
  if (error) {
    console.error("Profil (accueil) :", error.message);
    return null;
  }
  return data ? data.onboarded_at !== null : null;
}

/** Mon profil (RLS : la ligne de l'utilisateur connecté). */
export async function getMyProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, travel_mode, home_place_id")
    .eq("id", userId)
    .maybeSingle<MyProfile>();
  if (error) throw new Error(`Lecture du profil : ${error.message}`);
  return data;
}

/**
 * Mes lieux seulement. La RLS laisse aussi voir les lieux des membres de mes groupes : on
 * filtre donc sur `owner_id`. Les lieux favoris d'un groupe (`is_group_favorite`, liés à un
 * groupe) sont gérés dans la page du groupe, pas ici.
 */
export async function getMyPlaces(supabase: SupabaseClient, userId: string): Promise<MyPlace[]> {
  const { data, error } = await supabase
    .from("places")
    .select("id, name, lat, lng")
    .eq("owner_id", userId)
    .eq("is_group_favorite", false)
    .order("created_at", { ascending: true })
    .returns<MyPlace[]>();
  if (error) throw new Error(`Lecture des lieux : ${error.message}`);
  return data ?? [];
}

/** Colonnes de `busy_blocks` lues par /horaire. */
export type MyBusyBlock = Pick<
  BusyBlockRow,
  | "id"
  | "owner_id"
  | "title"
  | "place_id"
  | "start_time"
  | "end_time"
  | "weekday"
  | "valid_from"
  | "valid_until"
  | "source"
> &
  Partial<Pick<BusyBlockRow, "deadline_id" | "movable">>;

const BLOCK_COLUMNS =
  "id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, source";

/**
 * Mon horaire (tous mes blocs ; la RLS laisse aussi voir ceux de mes groupes : filtre). Avec
 * l'échéance et « déplaçable » des séances d'étude (migration 0011) ; sans elles si la
 * migration n'est pas encore appliquée (l'horaire reste utilisable).
 */
export async function getMyBusyBlocks(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyBusyBlock[]> {
  const read = (columns: string) =>
    supabase
      .from("busy_blocks")
      .select(columns)
      .eq("owner_id", userId)
      .order("weekday", { ascending: true, nullsFirst: false })
      .order("start_time", { ascending: true })
      .returns<MyBusyBlock[]>();
  let { data, error } = await read(`${BLOCK_COLUMNS}, deadline_id, movable`);
  if (error?.code === "42703") ({ data, error } = await read(BLOCK_COLUMNS));
  if (error) throw new Error(`Lecture de l'horaire : ${error.message}`);
  return data ?? [];
}

/**
 * Mes « heures où je ne sors pas » (colonnes de la migration 0004). `null` si on ne peut pas
 * les lire (migration 0004 pas encore appliquée) : la page l'indique au lieu de planter.
 */
export async function getMyQuietHours(
  supabase: SupabaseClient,
  userId: string,
): Promise<Pick<ProfileRow, "unavailable_before" | "unavailable_after"> | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("unavailable_before, unavailable_after")
    .eq("id", userId)
    .maybeSingle<Pick<ProfileRow, "unavailable_before" | "unavailable_after">>();
  if (error) {
    console.error("Profil (heures où je ne sors pas) :", error.code, error.message);
    return null;
  }
  return data ?? { unavailable_before: null, unavailable_after: null };
}

/**
 * Mon réglage de confidentialité (colonne de la migration 0006) : vrai = les membres de mes
 * groupes voient « Occupé » au lieu du titre de mes blocs. `null` si on ne peut pas le lire
 * (migration 0006 pas encore appliquée).
 */
export async function getMyPrivacy(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("hide_block_titles")
    .eq("id", userId)
    .maybeSingle<{ hide_block_titles: boolean }>();
  if (error) {
    console.error("Profil (confidentialité) :", error.code, error.message);
    return null;
  }
  return data?.hide_block_titles ?? true;
}

/**
 * Mes préférences d'étude (table de la migration 0011). Jamais réglées : préférences par
 * défaut. `null` si on ne peut pas les lire (migration 0011 pas encore appliquée).
 */
export async function getMyStudyPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<StudyPreferences | null> {
  const { data, error } = await supabase
    .from("study_preferences")
    .select(
      "min_session_minutes, max_session_minutes, max_minutes_per_day, break_minutes, study_start, study_end, eve_cutoff, keep_free_percent",
    )
    .eq("owner_id", userId)
    .maybeSingle<StudyPreferencesInput>();
  if (error) {
    console.error("Profil (préférences d'étude) :", error.code, error.message);
    return null;
  }
  return toStudyPreferences(data);
}
