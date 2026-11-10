import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BusyBlockInput } from "@/lib/db/convert";
import type { Locale } from "@/lib/i18n/config";

import { computePlanReviews, reviewTargets, withReview } from "./review";
import type { PlanView } from "./view";

/**
 * Plans « à revoir » : relit, au nom de la personne connectée (RLS), l'horaire des membres de
 * ses groupes par `group_busy_blocks` (la même lecture que « Quand on peut se voir ») et
 * signale ses prochains plans où quelqu'un qui y va a maintenant autre chose. En cas
 * d'erreur, les plans sont rendus tels quels (la page s'affiche quand même).
 */
export async function addPlanReview(
  supabase: SupabaseClient,
  myId: string,
  views: PlanView[],
  now: Date,
  locale: Locale = "fr",
): Promise<PlanView[]> {
  const targets = reviewTargets(views, now);
  if (targets.length === 0) return views;
  try {
    const groupIds = [...new Set(targets.map((t) => t.groupId))];
    const results = await Promise.all(
      groupIds.map((gid) => supabase.rpc("group_busy_blocks", { gid })),
    );
    const blocksByGroup = new Map<string, BusyBlockInput[]>();
    results.forEach((r, i) => {
      if (r.error) {
        console.error("Plans à revoir :", r.error.code, r.error.message);
        return;
      }
      // supabase-js sans types générés ne connaît pas la forme d'une fonction : on la précise.
      blocksByGroup.set(groupIds[i], (r.data ?? []) as unknown as BusyBlockInput[]);
    });
    return withReview(views, computePlanReviews(targets, blocksByGroup, myId, locale));
  } catch (e) {
    console.error("Plans à revoir :", e);
    return views;
  }
}
