/**
 * « Trouver un autre moment » pour un plan « à revoir » : prépare la recherche de moments du
 * groupe avec les mêmes personnes et la même durée que le plan. Fonctions pures.
 */
import type { PlanView } from "./view";

/** Bornes de durée acceptées par la recherche (voir `isValidMeetupDuration`). */
export interface DurationLimits {
  min: number;
  max: number;
}

/** Recherche préremplie à partir d'un plan. */
export interface ReplanRequest {
  planId: string;
  title: string;
  /** « jeudi 12 novembre, 18 h – 20 h » : le moment à remplacer. */
  when: string;
  /** Personnes qui y vont et sont encore membres (au moins 2), sinon tout le groupe. */
  participantIds: string[];
  /** Durée du plan, arrondie aux 5 min et ramenée dans les bornes de la recherche. */
  durationMinutes: number;
  /** Je l'ai proposé : je peux annuler l'ancien plan une fois le nouveau proposé. */
  isMine: boolean;
}

/** Lien « Trouver un autre moment » d'un plan (page de son groupe, recherche préremplie). */
export function replanHref(plan: Pick<PlanView, "id" | "groupId">): string {
  return `/groupes/${plan.groupId}?replanifier=${plan.id}#se-voir`;
}

/**
 * Recherche à lancer pour déplacer le plan `planId`, ou `null` si ce plan n'est pas un de mes
 * prochains plans de ce groupe (annulé, passé, refusé, inconnu : le lien ne fait alors rien).
 */
export function replanRequest(
  views: readonly PlanView[],
  planId: string | undefined,
  memberIds: readonly string[],
  limits: DurationLimits,
): ReplanRequest | null {
  const plan = planId ? views.find((v) => v.id === planId) : undefined;
  if (!plan || plan.state !== "upcoming" || !(plan.isMine || plan.myResponse === "yes")) {
    return null;
  }
  const going = plan.going.map((g) => g.id).filter((id) => memberIds.includes(id));
  const minutes = (Date.parse(plan.endsAt) - Date.parse(plan.startsAt)) / 60_000;
  const rounded = Math.round(minutes / 5) * 5;
  return {
    planId: plan.id,
    title: plan.title,
    when: `${plan.dayLabel}, ${plan.timeLabel}`,
    participantIds: going.length >= 2 ? going : [...memberIds],
    durationMinutes: Math.min(limits.max, Math.max(limits.min, rounded)),
    isMine: plan.isMine,
  };
}
