"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { localDay } from "@/lib/scheduling/period";
import { validateAvailabilityForm } from "@/lib/scheduling/oneOffAvailability";
import { formatClock, shiftDay } from "@/lib/scheduling/weeklyBlocks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ajoute une disponibilité ponctuelle (« ce samedi, libre de 13 h à 18 h »). La BD revérifie
 * tout (contraintes, jour dans l'année, 100 au plus, RLS : seulement pour moi).
 */
export async function ajouterDisponibilite(input: unknown): Promise<ActionResult> {
  const today = localDay(new Date());
  const form = validateAvailabilityForm(input, today, shiftDay(today, 365));
  if (!form.ok) return fail(form.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { error } = await ctx.supabase.from("availability_slots").insert({
    owner_id: ctx.user.id,
    day: form.value.day,
    start_time: formatClock(form.value.startMinute),
    end_time: formatClock(form.value.endMinute),
    note: form.value.note,
  });
  if (error) return fail(dbErrorMessage("Ajout de disponibilité", error));
  revalidatePath("/horaire");
  return { ok: true };
}

/** Supprime une de mes disponibilités ponctuelles. */
export async function supprimerDisponibilite(id: unknown): Promise<ActionResult> {
  if (typeof id !== "string" || !UUID.test(id)) return fail("Disponibilité introuvable.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);

  const { data, error } = await ctx.supabase
    .from("availability_slots")
    .delete()
    .eq("id", id.toLowerCase())
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Suppression de disponibilité", error));
  if (!data?.length) return fail("Disponibilité introuvable.");
  revalidatePath("/horaire");
  return { ok: true };
}
