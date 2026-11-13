"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { validateUuid } from "@/lib/groups/validation";
import { validatePropose } from "@/lib/plans/validation";

/** Message d'une erreur des fonctions de plans (leurs messages sont déjà en français). */
function planError(context: string, error: { code?: string; message: string }): string {
  if (error.code === "54000" && /blocs/.test(error.message)) {
    console.error(`${context} :`, error.code, error.message);
    return "Ton horaire est plein (1000 blocs au maximum) : supprime des blocs dans Mon horaire, puis réessaie.";
  }
  const own =
    error.code === "22023" ||
    error.code === "54000" ||
    error.code === "P0002" ||
    (error.code === "42501" && !/permission denied|row-level security/i.test(error.message));
  if (own) {
    console.error(`${context} :`, error.code, error.message);
    return error.message;
  }
  return dbErrorMessage(context, error);
}

function refresh(groupId?: string) {
  revalidatePath("/plans");
  revalidatePath("/horaire");
  if (groupId) revalidatePath(`/groupes/${groupId}`);
  // Badge « Plans » de l'en-tête, sur toutes les pages.
  revalidatePath("/", "layout");
}

export type ProposeResult = { ok: true; id: string } | { ok: false; error: string };

/** Propose un moment au groupe (tout le groupe ou des membres choisis). */
export async function proposerMoment(raw: unknown): Promise<ProposeResult> {
  const input = validatePropose(raw, new Date());
  if (!input.ok) return input;
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  const v = input.value;
  const common = {
    p_group: v.groupId,
    p_starts_at: v.startsAt,
    p_ends_at: v.endsAt,
    p_title: v.title,
    p_place: v.placeId,
    p_location: v.location,
    p_invitees: v.inviteeIds,
  };
  // Story 5 : un plan qui se répète passe par propose_recurring_meetup (migration 0018).
  const { data, error } = v.repeat
    ? await ctx.supabase.rpc("propose_recurring_meetup", {
        ...common,
        p_repeat_unit: v.repeat.unit,
        p_repeat_every: v.repeat.every,
        p_repeat_until: v.repeat.until,
      })
    : await ctx.supabase.rpc("propose_meetup", common);
  if (error) {
    if (v.repeat && (error.code === "PGRST202" || error.code === "42883")) {
      console.error("Proposer une série :", error.code, error.message);
      return {
        ok: false,
        error:
          "La base de données n'est pas à jour : applique supabase/migration-0018.sql (voir README).",
      };
    }
    return { ok: false, error: planError("Proposer un moment", error) };
  }
  if (typeof data !== "string") return { ok: false, error: "La proposition n'a pas fonctionné." };
  refresh(v.groupId);
  return { ok: true, id: data };
}

/** J'accepte (le moment s'ajoute à mon horaire) ou je refuse (il en est retiré). */
export async function repondrePlan(
  planId: unknown,
  accept: unknown,
  groupId?: unknown,
): Promise<ActionResult> {
  const pid = validateUuid(planId, "Plan introuvable.");
  if (!pid.ok) return fail(pid.error);
  if (typeof accept !== "boolean") return fail("Réponse invalide.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { error } = await ctx.supabase.rpc("respond_to_meetup", {
    p_plan: pid.value,
    p_accept: accept,
  });
  if (error) return fail(planError("Répondre au plan", error));
  const gid = validateUuid(groupId);
  refresh(gid.ok ? gid.value : undefined);
  return { ok: true };
}

/**
 * Le créateur annule son plan (retiré de l'horaire de tout le monde). Plan récurrent : le
 * créateur ou une personne qui l'a accepté arrête la série pour tout le monde (story 5).
 */
export async function annulerPlan(planId: unknown, groupId?: unknown): Promise<ActionResult> {
  const pid = validateUuid(planId, "Plan introuvable.");
  if (!pid.ok) return fail(pid.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { error } = await ctx.supabase.rpc("cancel_meetup", { p_plan: pid.value });
  if (error) return fail(planError("Annuler le plan", error));
  const gid = validateUuid(groupId);
  refresh(gid.ok ? gid.value : undefined);
  return { ok: true };
}
