"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";
import { revalidatePath } from "next/cache";

import { dbErrorMessage, requireUser } from "@/lib/actions";
import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";
import { fromBlockSpec } from "@/lib/db/convert";
import {
  type ConfirmResult,
  confirmIcsImport,
  type IcsStore,
  type PreviewResult,
  previewIcsImport,
} from "@/lib/import/icsImport";
import { TIME_ZONE } from "@/lib/scheduling/time";

/** Accès Supabase de l'import, au nom de la personne connectée (la RLS s'applique). */
function supabaseIcsStore(supabase: SupabaseClient, userId: string): IcsStore {
  return {
    async countIcsBlocks() {
      const { count, error } = await supabase
        .from("busy_blocks")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("source", "ics");
      if (error) return { ok: false, error: dbErrorMessage("Import .ics (compte)", error) };
      return { ok: true, value: count ?? 0 };
    },
    async createPlaces(places) {
      // Identifiants choisis ici : on sait ainsi quel lieu correspond à quel texte du fichier.
      const rows = places.map((p) => ({ ...p, id: crypto.randomUUID(), owner_id: userId }));
      const { error } = await supabase.from("places").insert(rows);
      if (error) return { ok: false, error: dbErrorMessage("Import .ics (lieux)", error) };
      return { ok: true, value: rows.map((r) => r.id) };
    },
    async deletePlaces(ids) {
      const { error } = await supabase.from("places").delete().eq("owner_id", userId).in("id", ids);
      if (error) return { ok: false, error: dbErrorMessage("Import .ics (annulation)", error) };
      return { ok: true, value: undefined };
    },
    async insertIcsBlocks(blocks) {
      const { data, error } = await supabase
        .from("busy_blocks")
        .insert(blocks.map((b) => ({ ...fromBlockSpec(b), owner_id: userId, source: "ics" })))
        .select("created_at");
      const rows = data as { created_at: string }[] | null;
      if (error || !rows?.length) {
        return {
          ok: false,
          error: error ? dbErrorMessage("Import .ics (blocs)", error) : "Import des blocs.",
        };
      }
      return { ok: true, value: { createdAt: rows[0].created_at } };
    },
    async deleteIcsBlocksBefore(createdAt) {
      const { data, error } = await supabase
        .from("busy_blocks")
        .delete()
        .eq("owner_id", userId)
        .eq("source", "ics")
        .lt("created_at", createdAt)
        .select("id");
      if (error) return { ok: false, error: dbErrorMessage("Import .ics (remplacement)", error) };
      return { ok: true, value: data?.length ?? 0 };
    },
  };
}

/**
 * Aperçus permis par personne et par minute. Lire un fichier .ics demande du calcul côté
 * serveur : sans limite, une seule personne pouvait relancer l'aperçu en boucle et ralentir
 * l'app pour tout le monde. Un usage normal (choisir un fichier, puis un autre) en fait 1 ou 2.
 */
const APERCUS_PAR_MINUTE = 10;
const apercuLimiter = createKeyedLimiter({ limit: APERCUS_PAR_MINUTE, windowMs: 60_000 });

/** Aperçu d'un fichier .ics (champ « fichier ») : lit seulement, n'écrit rien. */
export async function apercuIcs(formData: FormData): Promise<PreviewResult> {
  const file = formData.get("fichier");
  if (!(file instanceof File)) return { ok: false, error: "Choisis un fichier .ics." };
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!apercuLimiter.tryAcquire(ctx.user.id)) {
    return { ok: false, error: "Trop d'aperçus d'un coup. Attends une minute et réessaie." };
  }
  const today = formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd");
  return previewIcsImport(supabaseIcsStore(ctx.supabase, ctx.user.id), file, today);
}

/** Confirme l'import : remplace mes blocs importés (source « ics ») par ceux de l'aperçu. */
export async function confirmerIcs(input: unknown): Promise<ConfirmResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  const result = await confirmIcsImport(supabaseIcsStore(ctx.supabase, ctx.user.id), input);
  if (result.ok) {
    revalidatePath("/horaire");
    if (result.placesCreated > 0) revalidatePath("/lieux");
  }
  return result;
}
