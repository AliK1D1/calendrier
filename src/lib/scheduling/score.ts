import { MS_PER_MINUTE, minutesBetween } from "./time";
import type { MeetupProposal } from "./types";

/**
 * Poids du classement (section 3 : « Classement »). Faciles à ajuster : chaque poids est
 * exprimé en points par unité indiquée.
 */
export interface ScoreWeights {
  /** Points par heure passée ensemble (plus long = mieux). */
  perHourTogether: number;
  /** Au-delà de cette durée (minutes), une rencontre plus longue ne rapporte plus de points. */
  durationCapMinutes: number;
  /** Points retirés par heure de trajet total du groupe (aller + retour de chacun). */
  perHourTotalTravel: number;
  /**
   * Points retirés par heure d'écart entre la personne qui voyage le plus et celle qui voyage
   * le moins (trajet réparti équitablement = mieux).
   */
  perHourTravelSpread: number;
  /** Points retirés par jour d'écart avec le début de la période (plus tôt = un peu mieux). */
  perDayLater: number;
  /** Points retirés à une proposition d'appel/visio (moins bien qu'en personne). */
  callPenalty: number;
}

/** Poids par défaut. */
export const DEFAULT_WEIGHTS: Readonly<ScoreWeights> = {
  perHourTogether: 10,
  durationCapMinutes: 180,
  perHourTotalTravel: 12,
  perHourTravelSpread: 6,
  perDayLater: 1,
  callPenalty: 8,
};

/** Détail du score, utile pour l'affichage et les tests. */
export interface ScoreBreakdown {
  duration: number;
  totalTravel: number;
  travelSpread: number;
  lateness: number;
  call: number;
  total: number;
}

/** Options de calcul du score. */
export interface ScoreOptions {
  /** Instant de référence pour la proximité dans le temps (ex. début de la période). */
  referenceTime?: Date;
}

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Score détaillé d'une proposition. */
export function scoreBreakdown(
  proposal: Pick<MeetupProposal, "kind" | "start" | "end" | "travelByPerson">,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  options: ScoreOptions = {},
): ScoreBreakdown {
  const minutesTogether = Math.min(
    Math.max(0, minutesBetween(proposal.start, proposal.end)),
    weights.durationCapMinutes,
  );
  const perPerson = Object.values(proposal.travelByPerson).map((leg) => leg.to + leg.from);
  const totalTravel = perPerson.reduce((sum, m) => sum + m, 0);
  const spread = perPerson.length > 0 ? Math.max(...perPerson) - Math.min(...perPerson) : 0;
  const daysLater = options.referenceTime
    ? Math.max(0, proposal.start.getTime() - options.referenceTime.getTime()) / MS_PER_DAY
    : 0;

  const duration = (minutesTogether / 60) * weights.perHourTogether;
  const travel = -(totalTravel / 60) * weights.perHourTotalTravel;
  const travelSpread = -(spread / 60) * weights.perHourTravelSpread;
  const lateness = -daysLater * weights.perDayLater;
  const call = proposal.kind === "call" ? -weights.callPenalty : 0;
  return {
    duration,
    totalTravel: travel,
    travelSpread,
    lateness,
    call,
    total: duration + travel + travelSpread + lateness + call,
  };
}

/** Score d'une proposition : plus il est élevé, plus la proposition est pratique. */
export function scoreProposal(
  proposal: Pick<MeetupProposal, "kind" | "start" | "end" | "travelByPerson">,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  options: ScoreOptions = {},
): number {
  return scoreBreakdown(proposal, weights, options).total;
}

/**
 * Part de chevauchement entre deux créneaux : durée commune ÷ durée du plus court (0 à 1).
 */
export function overlapRatio(
  a: Pick<MeetupProposal, "start" | "end">,
  b: Pick<MeetupProposal, "start" | "end">,
): number {
  const common =
    Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime());
  if (common <= 0) return 0;
  const shortest = Math.min(
    a.end.getTime() - a.start.getTime(),
    b.end.getTime() - b.start.getTime(),
  );
  return shortest > 0 ? common / shortest : 0;
}
