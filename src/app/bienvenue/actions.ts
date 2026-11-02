"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { safeNextPath } from "@/lib/auth/paths";
import { validateOnboardingInput } from "@/lib/places/validation";

/**
 * Termine l'accueil : maison + cégep/école (facultatif) + mode de transport, en une seule
 * transaction (fonction SQL complete_onboarding, soumise à la RLS). Puis va à `next`.
 */
export async function terminerAccueil(input: unknown, next: unknown): Promise<ActionResult> {
  const v = validateOnboardingInput(input);
  if (!v.ok) return fail(v.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { home, school, travelMode } = v.value;
  const { error } = await ctx.supabase.rpc("complete_onboarding", {
    home_name: home.name,
    home_lat: home.lat,
    home_lng: home.lng,
    school_name: school?.name ?? null,
    school_lat: school?.lat ?? null,
    school_lng: school?.lng ?? null,
    mode: travelMode,
  });
  if (error) return fail(dbErrorMessage("Accueil", error));
  revalidatePath("/", "layout");
  redirect(safeNextPath(typeof next === "string" ? next : null));
}

/** « Plus tard » : on ne redemande plus l'accueil ; les lieux se gèrent dans /lieux. */
export async function passerAccueil(next: unknown): Promise<ActionResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { error } = await ctx.supabase.rpc("complete_onboarding", {});
  if (error) return fail(dbErrorMessage("Accueil", error));
  revalidatePath("/", "layout");
  redirect(safeNextPath(typeof next === "string" ? next : null));
}
