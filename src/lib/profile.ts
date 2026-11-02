import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlaceRow, ProfileRow } from "@/lib/db/schema";

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
 * filtre donc sur `owner_id`.
 */
export async function getMyPlaces(supabase: SupabaseClient, userId: string): Promise<MyPlace[]> {
  const { data, error } = await supabase
    .from("places")
    .select("id, name, lat, lng")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .returns<MyPlace[]>();
  if (error) throw new Error(`Lecture des lieux : ${error.message}`);
  return data ?? [];
}
