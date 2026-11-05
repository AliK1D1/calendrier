"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, fail, requireUser } from "@/lib/actions";
import { subscriptionDeps } from "@/lib/subscriptions/server";
import {
  addIcsSubscription,
  addOutlookSubscription,
  outlookCandidates,
  syncSubscriptions,
} from "@/lib/subscriptions/service";
import { supabaseSubscriptionStore } from "@/lib/subscriptions/supabaseStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHOOSE = "Choisis si ce calendrier compte comme du temps occupé.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function revalidateSchedule() {
  revalidatePath("/profil");
  revalidatePath("/horaire");
  revalidatePath("/etude");
  revalidatePath("/groupes", "layout");
}

type TextResult = ActionResult & { text?: string };

const added = (events: number, busy: boolean): TextResult => ({
  ok: true,
  text:
    (events === 0
      ? "Calendrier ajouté (rien de prévu dans les 8 prochaines semaines pour l'instant)."
      : `Calendrier ajouté : ${events} ${events > 1 ? "événements" : "événement"} dans les 8 prochaines semaines.`) +
    (busy
      ? " Ils comptent comme du temps occupé."
      : " Ils sont affichés sans bloquer ton temps libre."),
});

/** Ajouter un calendrier par son lien (.ics, webcal://). */
export async function ajouterAbonnement(input: unknown): Promise<TextResult> {
  if (!isRecord(input) || typeof input.url !== "string")
    return fail("Colle le lien du calendrier.");
  if (typeof input.countsAsBusy !== "boolean") return fail(CHOOSE);
  const name = typeof input.name === "string" ? input.name.slice(0, 200) : "";
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const r = await addIcsSubscription(subscriptionDeps(ctx.supabase, ctx.user.id), {
    url: input.url.slice(0, 3000),
    name,
    countsAsBusy: input.countsAsBusy,
  });
  revalidateSchedule();
  return r.ok ? added(r.events, input.countsAsBusy) : fail(r.error);
}

/** Ajouter un calendrier du compte Outlook connecté. */
export async function ajouterAbonnementOutlook(input: unknown): Promise<TextResult> {
  if (
    !isRecord(input) ||
    typeof input.calendarId !== "string" ||
    input.calendarId.length === 0 ||
    input.calendarId.length > 1024
  ) {
    return fail("Choisis un calendrier.");
  }
  if (typeof input.countsAsBusy !== "boolean") return fail(CHOOSE);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const r = await addOutlookSubscription(subscriptionDeps(ctx.supabase, ctx.user.id), {
    calendarId: input.calendarId,
    countsAsBusy: input.countsAsBusy,
  });
  revalidateSchedule();
  return r.ok ? added(r.events, input.countsAsBusy) : fail(r.error);
}

export type OutlookCandidatesResult =
  | { ok: true; calendars: { id: string; name: string; readOnly: boolean }[] }
  | { ok: false; error: string };

/** Calendriers du compte Outlook qu'on peut ajouter (abonnés dans Outlook d'abord). */
export async function listerCalendriersOutlookAbonnables(): Promise<OutlookCandidatesResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const r = await outlookCandidates(subscriptionDeps(ctx.supabase, ctx.user.id));
  return r.ok ? r : { ok: false, error: r.error };
}

/** Bouton « Actualiser » d'un calendrier (au plus aux 2 minutes). */
export async function actualiserAbonnement(id: unknown): Promise<TextResult> {
  if (typeof id !== "string" || !UUID.test(id)) return fail("Calendrier invalide.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const r = await syncSubscriptions(subscriptionDeps(ctx.supabase, ctx.user.id), {
    manual: true,
    id,
  });
  revalidateSchedule();
  if (r.error) return fail(`${r.error} On garde la dernière version connue.`);
  if (r.synced === 0) return { ok: true, text: "Déjà à jour : réessaie dans quelques minutes." };
  return { ok: true, text: "Calendrier actualisé." };
}

/** « Compte comme occupé » oui / non. */
export async function changerOccupeAbonnement(id: unknown, busy: unknown): Promise<TextResult> {
  if (typeof id !== "string" || !UUID.test(id)) return fail("Calendrier invalide.");
  if (typeof busy !== "boolean") return fail(CHOOSE);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  try {
    await supabaseSubscriptionStore(ctx.supabase, ctx.user.id).setBusy(id, busy);
  } catch (e) {
    console.error("Abonnement (occupé) :", e instanceof Error ? e.message : e);
    return fail(
      e instanceof Error && e.name === "SubscriptionError"
        ? e.message
        : "Le changement n'a pas fonctionné. Réessaie.",
    );
  }
  revalidateSchedule();
  return {
    ok: true,
    text: busy
      ? "Ses événements comptent maintenant comme du temps occupé."
      : "Ses événements sont affichés sans bloquer ton temps libre.",
  };
}

/** Retirer un calendrier : ses événements ne sont plus affichés ni utilisés. */
export async function retirerAbonnement(id: unknown): Promise<TextResult> {
  if (typeof id !== "string" || !UUID.test(id)) return fail("Calendrier invalide.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  try {
    await supabaseSubscriptionStore(ctx.supabase, ctx.user.id).remove(id);
  } catch (e) {
    console.error("Abonnement (retrait) :", e instanceof Error ? e.message : e);
    return fail("Le retrait n'a pas fonctionné. Réessaie.");
  }
  revalidateSchedule();
  return { ok: true, text: "Calendrier retiré : ses événements ne sont plus utilisés." };
}
