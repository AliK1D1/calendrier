"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { normalizeInviteCode, validateGroupName, validateUuid } from "@/lib/groups/validation";
import { validatePlaceId, validatePlaceInput } from "@/lib/places/validation";

export type IdResult = { ok: true; id: string } | { ok: false; error: string };
export type CodeResult = { ok: true; code: string } | { ok: false; error: string };

const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

function refresh(groupId?: string) {
  revalidatePath("/groupes");
  if (groupId) revalidatePath(`/groupes/${groupId}`);
}

/** Crée un groupe (j'en deviens l'admin) et renvoie son identifiant. */
export async function creerGroupe(name: unknown): Promise<IdResult> {
  const groupName = validateGroupName(name);
  if (!groupName.ok) return err(groupName.error);
  const ctx = await requireUser();
  if (!ctx.ok) return err(ctx.error);

  const { data, error } = await ctx.supabase.rpc("create_group", { group_name: groupName.value });
  if (error) return err(dbErrorMessage("Création du groupe", error));
  if (typeof data !== "string") return err("La création du groupe n'a pas fonctionné.");
  refresh();
  return { ok: true, id: data };
}

/** Rejoint un groupe avec son code d'invitation ; renvoie l'identifiant du groupe. */
export async function rejoindreGroupe(code: unknown): Promise<IdResult> {
  const invite = normalizeInviteCode(code);
  if (!invite.ok) return err(invite.error);
  const ctx = await requireUser();
  if (!ctx.ok) return err(ctx.error);

  const { data, error } = await ctx.supabase.rpc("join_group_by_code", { code: invite.value });
  if (error) {
    if (error.code === "P0002") {
      return err("Ce lien d'invitation n'est plus valide. Demande un nouveau lien.");
    }
    return err(dbErrorMessage("Rejoindre le groupe", error));
  }
  if (typeof data !== "string") return err("Impossible de rejoindre ce groupe.");
  refresh(data);
  return { ok: true, id: data };
}

/** Admin : remplace le code d'invitation (l'ancien lien cesse de marcher). */
export async function regenererCode(groupId: unknown): Promise<CodeResult> {
  const gid = validateUuid(groupId);
  if (!gid.ok) return err(gid.error);
  const ctx = await requireUser();
  if (!ctx.ok) return err(ctx.error);

  const { data, error } = await ctx.supabase.rpc("regenerate_invite_code", { gid: gid.value });
  if (error) return err(dbErrorMessage("Nouveau lien d'invitation", error));
  if (typeof data !== "string") return err("Groupe introuvable.");
  refresh(gid.value);
  return { ok: true, code: data };
}

/** Je quitte le groupe (s'il ne reste personne, il est supprimé). */
export async function quitterGroupe(groupId: unknown): Promise<ActionResult> {
  const gid = validateUuid(groupId);
  if (!gid.ok) return fail(gid.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("group_members")
    .delete()
    .eq("group_id", gid.value)
    .eq("user_id", ctx.user.id)
    .select("user_id");
  if (error) return fail(dbErrorMessage("Quitter le groupe", error));
  if (!data?.length) return fail("Tu ne fais pas partie de ce groupe.");
  refresh(gid.value);
  return { ok: true };
}

/** Admin : retire un autre membre du groupe (la RLS refuse si je ne suis pas admin). */
export async function retirerMembre(groupId: unknown, userId: unknown): Promise<ActionResult> {
  const gid = validateUuid(groupId);
  if (!gid.ok) return fail(gid.error);
  const uid = validateUuid(userId, "Membre introuvable.");
  if (!uid.ok) return fail(uid.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  if (uid.value === ctx.user.id) return fail("Pour partir, utilise « Quitter le groupe ».");

  const { data, error } = await ctx.supabase
    .from("group_members")
    .delete()
    .eq("group_id", gid.value)
    .eq("user_id", uid.value)
    .select("user_id");
  if (error) return fail(dbErrorMessage("Retirer le membre", error));
  if (!data?.length) return fail("Seul un admin du groupe peut retirer un membre.");
  refresh(gid.value);
  return { ok: true };
}

/** Ajoute un lieu favori au groupe (café, parc…), visible par ses membres seulement. */
export async function ajouterFavori(groupId: unknown, input: unknown): Promise<ActionResult> {
  const gid = validateUuid(groupId);
  if (!gid.ok) return fail(gid.error);
  const place = validatePlaceInput(input);
  if (!place.ok) return fail(place.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { error } = await ctx.supabase.from("places").insert({
    owner_id: ctx.user.id,
    ...place.value,
    group_id: gid.value,
    is_group_favorite: true,
  });
  if (error) return fail(dbErrorMessage("Ajout du lieu du groupe", error));
  refresh(gid.value);
  return { ok: true };
}

/** Supprime un lieu favori (le mien, ou n'importe lequel si je suis admin : RLS). */
export async function supprimerFavori(groupId: unknown, placeId: unknown): Promise<ActionResult> {
  const gid = validateUuid(groupId);
  if (!gid.ok) return fail(gid.error);
  const pid = validatePlaceId(placeId);
  if (!pid.ok) return fail(pid.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("places")
    .delete()
    .eq("id", pid.value)
    .eq("group_id", gid.value)
    .select("id");
  if (error) return fail(dbErrorMessage("Supprimer le lieu du groupe", error));
  if (!data?.length) return fail("Seul l'auteur du lieu ou un admin peut le supprimer.");
  refresh(gid.value);
  return { ok: true };
}
