"use server";

import { revalidatePath } from "next/cache";

import { fromBlockSpec } from "@/lib/db/convert";
import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { validateBlockForm, validateBlockId } from "@/lib/scheduling/weeklyBlocks";

const done = (): ActionResult => {
  revalidatePath("/horaire");
  return { ok: true };
};

/**
 * Ajoute un bloc à mon horaire (un par jour coché s'il est hebdomadaire), en une seule
 * requête : tout ou rien. Source « manual ». La RLS refuse un lieu qui n'est pas à moi.
 */
export async function ajouterBlocs(input: unknown): Promise<ActionResult> {
  const blocs = validateBlockForm(input);
  if (!blocs.ok) return fail(blocs.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { error } = await ctx.supabase
    .from("busy_blocks")
    .insert(
      blocs.value.map((b) => ({ ...fromBlockSpec(b), owner_id: ctx.user.id, source: "manual" })),
    );
  if (error) return fail(dbErrorMessage("Ajout de bloc", error));
  return done();
}

/** Modifie un de mes blocs (un seul jour de semaine pour un bloc hebdomadaire). */
export async function modifierBloc(id: unknown, input: unknown): Promise<ActionResult> {
  const blockId = validateBlockId(id);
  if (!blockId.ok) return fail(blockId.error);
  const blocs = validateBlockForm(input, { single: true });
  if (!blocs.ok) return fail(blocs.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("busy_blocks")
    .update(fromBlockSpec(blocs.value[0]))
    .eq("id", blockId.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Modification de bloc", error));
  if (!data?.length) return fail("Bloc introuvable.");
  return done();
}

/** Supprime un de mes blocs (toutes ses semaines s'il est hebdomadaire). */
export async function supprimerBloc(id: unknown): Promise<ActionResult> {
  const blockId = validateBlockId(id);
  if (!blockId.ok) return fail(blockId.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("busy_blocks")
    .delete()
    .eq("id", blockId.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Suppression de bloc", error));
  if (!data?.length) return fail("Bloc introuvable.");
  return done();
}
