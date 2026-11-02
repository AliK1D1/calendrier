"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { validateDisplayName, validateTravelMode } from "@/lib/places/validation";

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
