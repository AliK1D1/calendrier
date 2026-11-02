"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { validateDisplayName, validateTravelMode } from "@/lib/places/validation";
import { quietHoursToDb, validateQuietHours } from "@/lib/scheduling/quietHours";

/** Met à jour mon nom affiché et mon mode de transport. */
export async function enregistrerProfil(input: unknown): Promise<ActionResult> {
  const r = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = validateDisplayName(r.displayName);
  if (!name.ok) return fail(name.error);
  const mode = validateTravelMode(r.travelMode);
  if (!mode.ok) return fail(mode.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("profiles")
    .update({ display_name: name.value, travel_mode: mode.value })
    .eq("id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Profil", error));
  if (!data?.length) return fail("Profil introuvable.");
  revalidatePath("/profil");
  return { ok: true };
}

/** Enregistre mes « heures où je ne sors pas » (traitées comme des blocs occupés). */
export async function enregistrerHeuresCalmes(input: unknown): Promise<ActionResult> {
  const quiet = validateQuietHours(input);
  if (!quiet.ok) return fail(quiet.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("profiles")
    .update(quietHoursToDb(quiet.value))
    .eq("id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Heures où je ne sors pas", error));
  if (!data?.length) return fail("Profil introuvable.");
  revalidatePath("/profil");
  revalidatePath("/horaire");
  return { ok: true };
}

/** Confidentialité : les membres de mes groupes voient « Occupé » au lieu de mes titres. */
export async function enregistrerConfidentialite(hideTitles: unknown): Promise<ActionResult> {
  if (typeof hideTitles !== "boolean") return fail("Réglage invalide.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("profiles")
    .update({ hide_block_titles: hideTitles })
    .eq("id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Confidentialité", error));
  if (!data?.length) return fail("Profil introuvable.");
  revalidatePath("/profil");
  revalidatePath("/groupes", "layout");
  return { ok: true };
}
