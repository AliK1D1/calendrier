"use server";

import { revalidatePath } from "next/cache";

import { formatInTimeZone } from "date-fns-tz";

import { type BusyBlockInput, fromBlockSpec, toBlockSpec } from "@/lib/db/convert";
import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { restoreOccurrence, skipOccurrence, validateSkipDay } from "@/lib/scheduling/skipDays";
import { TIME_ZONE } from "@/lib/scheduling/time";
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

const SKIP_COLUMNS =
  "id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, source, skip_days";

const MIGRATION_0021 =
  "La base de données n'est pas à jour : applique supabase/migration-0021.sql (voir README).";

/**
 * « Cours annulé cette fois-ci » : annule (`skip` vrai) ou rétablit UNE occurrence d'un de mes
 * blocs qui reviennent. Les autres semaines ne changent pas. Un plan de groupe ou une séance
 * d'étude ne s'annule pas ici (on le refuse dans « Mes plans » / « Étude »).
 */
async function changerOccurrence(id: unknown, day: unknown, skip: boolean): Promise<ActionResult> {
  const blockId = validateBlockId(id);
  if (!blockId.ok) return fail(blockId.error);
  const jour = validateSkipDay(day);
  if (!jour.ok) return fail(jour.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const read = await ctx.supabase
    .from("busy_blocks")
    .select(SKIP_COLUMNS)
    .eq("id", blockId.value)
    .eq("owner_id", ctx.user.id)
    .maybeSingle<BusyBlockInput & { source: string }>();
  if (read.error?.code === "42703") return fail(MIGRATION_0021);
  if (read.error) return fail(dbErrorMessage("Occurrence annulée", read.error));
  if (!read.data) return fail("Bloc introuvable.");
  if (!["manual", "ics", "image"].includes(read.data.source)) {
    return fail("Ce bloc ne s'annule pas ici.");
  }

  const spec = toBlockSpec(read.data);
  let next: string[];
  if (skip) {
    const today = formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd");
    const r = skipOccurrence(spec, jour.value, today);
    if (!r.ok) return fail(r.error);
    next = r.value;
  } else {
    next = restoreOccurrence(spec, jour.value);
  }

  const { data, error } = await ctx.supabase
    .from("busy_blocks")
    .update({ skip_days: next })
    .eq("id", blockId.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Occurrence annulée", error));
  if (!data?.length) return fail("Bloc introuvable.");
  // Les autres voient le changement dans « Quand on peut se voir » et dans leurs plans.
  revalidatePath("/plans");
  return done();
}

/** Annule l'occurrence du jour `day` d'un de mes blocs qui reviennent. */
export async function annulerOccurrence(id: unknown, day: unknown): Promise<ActionResult> {
  return changerOccurrence(id, day, true);
}

/** Rétablit une occurrence annulée. */
export async function retablirOccurrence(id: unknown, day: unknown): Promise<ActionResult> {
  return changerOccurrence(id, day, false);
}
