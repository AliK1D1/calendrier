"use server";

import { requireUser } from "@/lib/actions";
import { type FreeNowView, searchFreeNow, validateFreeNow } from "@/lib/meetups/freeNow";
import { freeNowLimiter, rechercheLimiter } from "@/lib/meetups/limits";
import {
  type MeetupSearchView,
  searchGroupMeetups,
  validateMeetupSearch,
} from "@/lib/meetups/search";
import { supabaseFreeNowStore, supabaseMeetupStore } from "@/lib/meetups/supabaseStore";
import type { Result } from "@/lib/places/validation";
import { getTravelProvider } from "@/lib/travel/server";

/** Cherche les moments réalistes pour les participants choisis d'un groupe. */
export async function chercherMoments(raw: unknown): Promise<Result<MeetupSearchView>> {
  const input = validateMeetupSearch(raw);
  if (!input.ok) return input;
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!rechercheLimiter.tryAcquire(ctx.user.id)) {
    return { ok: false, error: "Trop de recherches d'un coup. Attends une minute et réessaie." };
  }
  try {
    return await searchGroupMeetups(supabaseMeetupStore(ctx.supabase), input.value, {
      userId: ctx.user.id,
      now: new Date(),
      travel: getTravelProvider(),
    });
  } catch (e) {
    console.error("Moments :", e);
    return { ok: false, error: "Le calcul n'a pas fonctionné. Réessaie." };
  }
}

/**
 * « Je suis libre maintenant » : qui, dans mes groupes (ou dans le groupe `groupId`), peut me
 * voir dans les 2 prochaines heures. Compte comme une recherche de moments (même limite), plus
 * une limite à part : le calcul essaie chaque membre de chaque groupe.
 */
export async function chercherLibresMaintenant(raw: unknown): Promise<Result<FreeNowView>> {
  const input = validateFreeNow(raw);
  if (!input.ok) return input;
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!freeNowLimiter.tryAcquire(ctx.user.id) || !rechercheLimiter.tryAcquire(ctx.user.id)) {
    return { ok: false, error: "Trop de recherches d'un coup. Attends une minute et réessaie." };
  }
  try {
    return await searchFreeNow(supabaseFreeNowStore(ctx.supabase), input.value, {
      userId: ctx.user.id,
      now: new Date(),
      travel: getTravelProvider(),
    });
  } catch (e) {
    console.error("Libre maintenant :", e);
    return { ok: false, error: "Le calcul n'a pas fonctionné. Réessaie." };
  }
}
