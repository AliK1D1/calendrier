/**
 * Plans « à revoir » : signale, sur mes prochains plans, les personnes qui y vont et qui ont
 * maintenant autre chose à ce moment-là (l'horaire a changé après l'acceptation). Assemble les
 * blocs lus en BD et la logique pure de `src/lib/scheduling/planConflicts.ts`, puis met le
 * résultat en mots. Aucun accès BD ici (les lectures sont dans `reviewQueries.ts`).
 *
 * Vie privée : pour les autres, on dit seulement qu'ils ne sont plus libres (ni titre ni
 * heures de leur bloc) ; le titre et les heures ne sont montrés que pour MON propre bloc.
 */
import { formatInTimeZone } from "date-fns-tz";

import { type BusyBlockInput, expandBusyBlocks } from "@/lib/db/convert";
import type { Locale } from "@/lib/i18n/config";
import { formatInstantClock } from "@/lib/i18n/format";
import { getMessages } from "@/lib/i18n/messages";
import { planConflicts } from "@/lib/scheduling/planConflicts";
import { TIME_ZONE } from "@/lib/scheduling/time";
import type { BusyBlock } from "@/lib/scheduling/types";

import type { PlanReviewView, PlanView } from "./view";

/** Plans vérifiés au plus par page (les plus proches). */
export const MAX_REVIEW_PLANS = 12;
/** Groupes lus au plus par page. */
export const MAX_REVIEW_GROUPS = 6;
/** On ne vérifie pas les plans plus loin que ce nombre de jours. */
export const REVIEW_HORIZON_DAYS = 60;

/**
 * Plans à vérifier : mes prochains plans (acceptés ou proposés par moi), pas finis, dans les
 * `REVIEW_HORIZON_DAYS` jours, les plus proches d'abord, dans au plus `MAX_REVIEW_GROUPS`
 * groupes.
 */
export function reviewTargets(views: readonly PlanView[], now: Date): PlanView[] {
  const horizon = now.getTime() + REVIEW_HORIZON_DAYS * 86_400_000;
  const groups = new Set<string>();
  const out: PlanView[] = [];
  const sorted = [...views].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const p of sorted) {
    if (out.length >= MAX_REVIEW_PLANS) break;
    if (p.state !== "upcoming" || !(p.isMine || p.myResponse === "yes")) continue;
    if (Date.parse(p.endsAt) <= now.getTime() || Date.parse(p.startsAt) > horizon) continue;
    if (!groups.has(p.groupId) && groups.size >= MAX_REVIEW_GROUPS) continue;
    groups.add(p.groupId);
    out.push(p);
  }
  return out;
}

/**
 * Conflits de chaque plan visé. `blocksByGroup` : blocs des membres de chaque groupe (tels que
 * renvoyés par `group_busy_blocks`). Un plan sans conflit n'est pas dans le résultat.
 */
export function computePlanReviews(
  targets: readonly PlanView[],
  blocksByGroup: ReadonlyMap<string, readonly BusyBlockInput[]>,
  myId: string,
  locale: Locale = "fr",
): Map<string, PlanReviewView> {
  const t = getMessages(locale).plans;
  const out = new Map<string, PlanReviewView>();
  for (const p of targets) {
    const rows = blocksByGroup.get(p.groupId);
    if (!rows) continue;
    const slot = { start: new Date(p.startsAt), end: new Date(p.endsAt) };
    const day = formatInTimeZone(slot.start, TIME_ZONE, "yyyy-MM-dd");
    const blocksByPerson = new Map<string, BusyBlock[]>();
    for (const g of p.going) {
      blocksByPerson.set(
        g.id,
        expandBusyBlocks(
          rows.filter((r) => r.owner_id === g.id),
          { from: day, to: day },
          "",
        ),
      );
    }
    const conflicts = planConflicts(
      slot,
      p.going.map((g) => g.id),
      blocksByPerson,
    );
    if (conflicts.length === 0) continue;
    const me = conflicts.find((c) => c.personId === myId);
    const others = conflicts
      .filter((c) => c.personId !== myId)
      .map((c) => p.going.find((g) => g.id === c.personId)?.name ?? t.noName);
    out.set(p.id, {
      mine: me
        ? t.reviewMine(
            me.block.title?.trim() || t.reviewSomething,
            formatInstantClock(me.block.start, locale),
            formatInstantClock(me.block.end, locale),
          )
        : null,
      others: others.length ? t.reviewOthers(others) : null,
    });
  }
  return out;
}

/** Ajoute « à revoir » aux plans concernés. */
export function withReview(
  views: readonly PlanView[],
  reviews: ReadonlyMap<string, PlanReviewView>,
): PlanView[] {
  return views.map((v) => {
    const review = reviews.get(v.id);
    return review ? { ...v, review } : v;
  });
}
