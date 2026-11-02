"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { validatePlaceId, validatePlaceInput, validatePlaceName } from "@/lib/places/validation";

const done = (): ActionResult => {
  revalidatePath("/lieux");
  return { ok: true };
};

/** Ajoute un lieu (nom + position choisie sur la carte). */
export async function ajouterLieu(input: unknown, commeMaison: unknown): Promise<ActionResult> {
  const place = validatePlaceInput(input);
  if (!place.ok) return fail(place.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("places")
    .insert({ owner_id: ctx.user.id, ...place.value })
    .select("id")
    .single<{ id: string }>();
  if (error) return fail(dbErrorMessage("Ajout du lieu", error));

  if (commeMaison === true) {
    const { error: e2 } = await ctx.supabase
      .from("profiles")
      .update({ home_place_id: data.id })
      .eq("id", ctx.user.id);
    if (e2) return fail(dbErrorMessage("Choix de la maison", e2));
  }
  return done();
}

/** Renomme un de mes lieux. */
export async function renommerLieu(id: unknown, name: unknown): Promise<ActionResult> {
  const placeId = validatePlaceId(id);
  if (!placeId.ok) return fail(placeId.error);
  const newName = validatePlaceName(name);
  if (!newName.ok) return fail(newName.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("places")
    .update({ name: newName.value })
    .eq("id", placeId.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Renommer le lieu", error));
  if (!data?.length) return fail("Lieu introuvable.");
  return done();
}

/** Supprime un de mes lieux (s'il était la maison, le profil n'a plus de maison). */
export async function supprimerLieu(id: unknown): Promise<ActionResult> {
  const placeId = validatePlaceId(id);
  if (!placeId.ok) return fail(placeId.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("places")
    .delete()
    .eq("id", placeId.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Supprimer le lieu", error));
  if (!data?.length) return fail("Lieu introuvable.");
  return done();
}

/** Choisit un de mes lieux comme maison (la RLS refuse un lieu qui n'est pas à moi). */
export async function definirMaison(id: unknown): Promise<ActionResult> {
  const placeId = validatePlaceId(id);
  if (!placeId.ok) return fail(placeId.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("profiles")
    .update({ home_place_id: placeId.value })
    .eq("id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Choix de la maison", error));
  if (!data?.length) return fail("Profil introuvable.");
  return done();
}
