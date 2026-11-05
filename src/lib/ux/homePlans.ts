import { groupPlans, type PlanView } from "@/lib/plans/view";

/**
 * Plans montrés sur l'accueil : d'abord ceux qui attendent ma réponse (tous, c'est l'action à
 * faire), puis mes prochains plans acceptés ou proposés (les `maxUpcoming` plus proches).
 * Avant, il fallait penser à ouvrir l'onglet Plans pour les voir.
 */
export function homePlans(
  views: readonly PlanView[],
  maxUpcoming = 2,
): { awaiting: PlanView[]; upcoming: PlanView[]; moreUpcoming: number } {
  const { awaiting, upcoming } = groupPlans(views);
  const sorted = [...upcoming].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    awaiting: [...awaiting].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    upcoming: sorted.slice(0, maxUpcoming),
    moreUpcoming: Math.max(0, sorted.length - maxUpcoming),
  };
}
