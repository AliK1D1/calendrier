"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, fail, requireUser } from "@/lib/actions";
import { outlookDeps } from "@/lib/outlook/server";
import {
  chooseOutlookCalendar,
  listOutlookCalendars,
  type SyncOutcome,
  syncOutlook,
} from "@/lib/outlook/service";
import { supabaseOutlookStore } from "@/lib/outlook/supabaseStore";

const NOT_CONFIGURED = "Outlook n'est pas encore configuré sur ce site.";

function revalidateSchedule() {
  revalidatePath("/profil");
  revalidatePath("/horaire");
  revalidatePath("/etude");
  revalidatePath("/groupes", "layout");
}

/** Message affiché après une synchronisation. */
function syncMessage(r: SyncOutcome): ActionResult & { text?: string } {
  if (r.status === "synced") {
    return {
      ok: true,
      text: r.truncated
        ? `Outlook synchronisé (${r.blocks} blocs, les plus proches seulement : il y en avait trop).`
        : "Outlook synchronisé.",
    };
  }
  if (r.status === "skipped") {
    if (r.reason === "none") return fail("Outlook n'est pas connecté.");
    return { ok: true, text: "Déjà à jour : réessaie dans une minute." };
  }
  return fail(r.message);
}

/** Bouton « Actualiser maintenant » (au plus une fois par minute). */
export async function actualiserOutlook(): Promise<ActionResult & { text?: string }> {
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const deps = outlookDeps(ctx.supabase, ctx.user.id);
  if (!deps) return fail(NOT_CONFIGURED);
  const r = await syncOutlook(deps, { manual: true });
  revalidateSchedule();
  return syncMessage(r);
}

export type CalendarsResult =
  | {
      ok: true;
      calendars: { id: string; name: string; isDefault: boolean }[];
      current: string | null;
    }
  | { ok: false; error: string };

/** Calendriers du compte Outlook, pour le choix du calendrier. */
export async function listerCalendriersOutlook(): Promise<CalendarsResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const deps = outlookDeps(ctx.supabase, ctx.user.id);
  if (!deps) return { ok: false, error: NOT_CONFIGURED };
  const r = await listOutlookCalendars(deps);
  return r.ok ? r : { ok: false, error: r.message };
}

/** Choisit le calendrier lu (`null` ou celui « par défaut » : le principal). */
export async function choisirCalendrierOutlook(
  calendarId: unknown,
): Promise<ActionResult & { text?: string }> {
  if (
    calendarId !== null &&
    (typeof calendarId !== "string" || calendarId.length === 0 || calendarId.length > 1024)
  ) {
    return fail("Calendrier invalide.");
  }
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const deps = outlookDeps(ctx.supabase, ctx.user.id);
  if (!deps) return fail(NOT_CONFIGURED);
  const r = await chooseOutlookCalendar(deps, calendarId);
  revalidateSchedule();
  if (!r.ok) return fail(r.message);
  return syncMessage(r.sync);
}

/**
 * « Déconnecter » : retire la connexion (le jeton chiffré) et TOUS les blocs Outlook. Marche
 * même si Outlook n'est plus configuré sur le site.
 */
export async function deconnecterOutlook(): Promise<ActionResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  try {
    await supabaseOutlookStore(ctx.supabase, ctx.user.id).disconnect();
  } catch (e) {
    console.error("Outlook : déconnexion :", e instanceof Error ? e.message : e);
    return fail("La déconnexion n'a pas fonctionné. Réessaie.");
  }
  revalidateSchedule();
  return { ok: true };
}
