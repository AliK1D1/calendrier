"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, dbErrorMessage, fail, requireUser } from "@/lib/actions";
import { fromStudyPreferences } from "@/lib/db/convert";
import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";
import { validateUuid } from "@/lib/groups/validation";
import type { Result } from "@/lib/places/validation";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import {
  checkMovedSession,
  prepareAcceptance,
  planMyStudy,
  replanMyConflicts,
  type AcceptResult,
  type SessionView,
  type StudyPlanView,
} from "@/lib/study/service";
import { supabaseStudyStore } from "@/lib/study/supabaseStore";
import {
  validateDeadlineForm,
  validateSessionInput,
  validateSessionList,
  validateStudyPreferencesForm,
} from "@/lib/study/validation";

/** Estimation partagée entre les requêtes (cache borné). */
const travel = new EstimatedTravelProvider();

/** Calculs par minute et par personne : le planificateur occupe le serveur. */
const calculLimiter = createKeyedLimiter({ limit: 30, windowMs: 60_000 });

const refresh = () => {
  revalidatePath("/etude");
  revalidatePath("/horaire");
};

/** Contexte d'un calcul : personne connectée, limite, magasin Supabase (RLS). */
async function studyContext() {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!calculLimiter.tryAcquire(ctx.user.id)) {
    return { ok: false as const, error: "Trop de calculs d'un coup. Attends une minute." };
  }
  return {
    ok: true as const,
    ctx,
    store: supabaseStudyStore(ctx.supabase, ctx.user.id),
    deps: { userId: ctx.user.id, now: new Date(), travel },
  };
}

/** Ajoute un examen ou un travail. */
export async function ajouterEcheance(input: unknown): Promise<ActionResult> {
  const v = validateDeadlineForm(input, new Date());
  if (!v.ok) return fail(v.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { error } = await ctx.supabase.from("deadlines").insert({
    owner_id: ctx.user.id,
    kind: v.value.kind,
    course: v.value.course,
    due_at: v.value.dueAt.toISOString(),
    estimated_hours: v.value.estimatedHours,
    difficulty: v.value.difficulty,
  });
  if (error) return fail(dbErrorMessage("Ajout d'échéance", error));
  refresh();
  return { ok: true };
}

/** Supprime un de mes examens ou travaux (et ses séances acceptées). */
export async function supprimerEcheance(id: unknown): Promise<ActionResult> {
  const d = validateUuid(id, "Échéance introuvable.");
  if (!d.ok) return fail(d.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { data, error } = await ctx.supabase
    .from("deadlines")
    .delete()
    .eq("id", d.value)
    .eq("owner_id", ctx.user.id)
    .select("id");
  if (error) return fail(dbErrorMessage("Suppression d'échéance", error));
  if (!data?.length) return fail("Échéance introuvable.");
  refresh();
  return { ok: true };
}

/** « Planifier mon étude » : séances proposées, rien n'est écrit. */
export async function planifierEtude(): Promise<Result<StudyPlanView>> {
  const c = await studyContext();
  if (!c.ok) return c;
  try {
    return await planMyStudy(c.store, c.deps);
  } catch (e) {
    console.error("Planifier :", e);
    return { ok: false, error: "Le calcul n'a pas fonctionné. Réessaie." };
  }
}

/** « Replanifier » : nouvelles places pour les séances en conflit, rien n'est écrit. */
export async function replanifierConflits(): Promise<Result<StudyPlanView>> {
  const c = await studyContext();
  if (!c.ok) return c;
  try {
    return await replanMyConflicts(c.store, c.deps);
  } catch (e) {
    console.error("Replanifier :", e);
    return { ok: false, error: "Le calcul n'a pas fonctionné. Réessaie." };
  }
}

/** Revalide une séance déplacée par glisser (les autres propositions affichées comptent). */
export async function verifierSeance(input: unknown): Promise<Result<SessionView>> {
  const r = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const session = validateSessionInput(r.session);
  if (!session.ok) return session;
  const others =
    Array.isArray(r.others) && r.others.length > 0
      ? validateSessionList(r.others)
      : { ok: true as const, value: [] };
  if (!others.ok) return others;
  const c = await studyContext();
  if (!c.ok) return c;
  try {
    return await checkMovedSession(c.store, session.value, others.value, c.deps);
  } catch (e) {
    console.error("Vérifier une séance :", e);
    return { ok: false, error: "La vérification n'a pas fonctionné. Réessaie." };
  }
}

/**
 * Accepte des séances proposées (ou les nouvelles places de séances en conflit) : tout est
 * revalidé côté serveur, puis écrit (source 'study', déplaçable par défaut). Tout ou rien pour
 * la validation ; les nouvelles séances sont écrites en une requête.
 */
export async function accepterSeances(input: unknown): Promise<AcceptResult> {
  const list = validateSessionList(input);
  if (!list.ok) return list;
  const c = await studyContext();
  if (!c.ok) return c;
  let plan;
  try {
    plan = await prepareAcceptance(c.store, list.value, c.deps);
  } catch (e) {
    console.error("Accepter :", e);
    return { ok: false, error: "La vérification n'a pas fonctionné. Réessaie." };
  }
  if (!plan.ok) return plan;
  const { supabase, user } = c.ctx;
  if (plan.value.inserts.length > 0) {
    const { error } = await supabase.from("busy_blocks").insert(
      plan.value.inserts.map((row) => ({
        ...row,
        owner_id: user.id,
        source: "study",
        movable: true,
      })),
    );
    if (error) return { ok: false, error: dbErrorMessage("Accepter des séances", error) };
  }
  for (const u of plan.value.updates) {
    const { data, error } = await supabase
      .from("busy_blocks")
      .update(u.row)
      .eq("id", u.id)
      .eq("owner_id", user.id)
      .eq("source", "study")
      .select("id");
    if (error) return { ok: false, error: dbErrorMessage("Déplacer une séance", error) };
    if (!data?.length) return { ok: false, error: "Séance introuvable." };
  }
  refresh();
  return { ok: true, count: plan.value.inserts.length + plan.value.updates.length };
}

/** Retire une séance acceptée de mon horaire. */
export async function retirerSeance(id: unknown): Promise<ActionResult> {
  const s = validateUuid(id, "Séance introuvable.");
  if (!s.ok) return fail(s.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { data, error } = await ctx.supabase
    .from("busy_blocks")
    .delete()
    .eq("id", s.value)
    .eq("owner_id", ctx.user.id)
    .eq("source", "study")
    .select("id");
  if (error) return fail(dbErrorMessage("Retirer une séance", error));
  if (!data?.length) return fail("Séance introuvable.");
  refresh();
  return { ok: true };
}

/** Une séance acceptée est-elle déplaçable (l'app propose de la replacer en cas de conflit) ? */
export async function changerDeplacable(id: unknown, movable: unknown): Promise<ActionResult> {
  const s = validateUuid(id, "Séance introuvable.");
  if (!s.ok) return fail(s.error);
  if (typeof movable !== "boolean") return fail("Réglage invalide.");
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  const { data, error } = await ctx.supabase
    .from("busy_blocks")
    .update({ movable })
    .eq("id", s.value)
    .eq("owner_id", ctx.user.id)
    .eq("source", "study")
    .select("id");
  if (error) return fail(dbErrorMessage("Séance déplaçable", error));
  if (!data?.length) return fail("Séance introuvable.");
  refresh();
  return { ok: true };
}

/** Préférences d'étude (/profil). */
export async function enregistrerPreferencesEtude(input: unknown): Promise<ActionResult> {
  const prefs = validateStudyPreferencesForm(input);
  if (!prefs.ok) return fail(prefs.error);
  const ctx = await requireUser();
  if (!ctx.ok) return fail(ctx.error);
  // Mise à jour, sinon création (pas d'upsert : owner_id n'est pas modifiable, droits par colonne).
  const values = fromStudyPreferences(prefs.value);
  const { data, error } = await ctx.supabase
    .from("study_preferences")
    .update(values)
    .eq("owner_id", ctx.user.id)
    .select("owner_id");
  if (error) return fail(dbErrorMessage("Préférences d'étude", error));
  if (!data?.length) {
    const { error: e2 } = await ctx.supabase
      .from("study_preferences")
      .insert({ owner_id: ctx.user.id, ...values });
    if (e2) return fail(dbErrorMessage("Préférences d'étude", e2));
  }
  revalidatePath("/profil");
  return { ok: true };
}
