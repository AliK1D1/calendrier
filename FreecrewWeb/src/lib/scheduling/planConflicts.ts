/**
 * Plans « à revoir » : un plan accepté peut devenir impossible quand l'horaire de quelqu'un
 * change après coup (nouveau cours, quart de travail, autre plan). Fonctions pures : on reçoit
 * les blocs occupés déjà dépliés de chaque participant et on dit qui est maintenant pris
 * pendant le plan.
 */
import type { BusyBlock, PersonId } from "./types";

/** Un moment (début inclus, fin exclue). */
export interface Slot {
  start: Date;
  end: Date;
}

/** Participant qui a autre chose pendant le plan. */
export interface PlanConflict {
  personId: PersonId;
  /** Le bloc qui chevauche le plus le plan. */
  block: BusyBlock;
  /** Minutes du plan couvertes par ce bloc. */
  overlapMinutes: number;
}

function overlapMs(slot: Slot, b: Slot): number {
  return (
    Math.min(slot.end.getTime(), b.end.getTime()) -
    Math.max(slot.start.getTime(), b.start.getTime())
  );
}

/**
 * Le bloc d'une personne qui entre en conflit avec le plan, ou `null`.
 *
 * Une personne qui a accepté un plan a, dans son horaire, le bloc de CE plan : exactement les
 * mêmes heures. On écarte donc UN bloc identique au plan (le sien). Un deuxième bloc identique
 * (deux plans acceptés au même moment) est bien un conflit. Un bloc qui touche seulement le
 * plan (finit quand il commence) n'en est pas un.
 */
export function conflictingBlock(
  slot: Slot,
  blocks: readonly BusyBlock[],
): PlanConflict["block"] | null {
  let ownSkipped = false;
  let best: BusyBlock | null = null;
  let bestMs = 0;
  for (const b of blocks) {
    const ms = overlapMs(slot, b);
    if (ms <= 0) continue;
    const same =
      b.start.getTime() === slot.start.getTime() && b.end.getTime() === slot.end.getTime();
    if (same && !ownSkipped) {
      ownSkipped = true;
      continue;
    }
    if (
      ms > bestMs ||
      (ms === bestMs && best !== null && b.start.getTime() < best.start.getTime())
    ) {
      best = b;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Participants (dans l'ordre donné) qui ont maintenant autre chose pendant le plan.
 * `blocksByPerson` : blocs dépliés de chaque personne autour du plan ; une personne absente
 * de la carte (horaire illisible) n'est pas signalée.
 */
export function planConflicts(
  slot: Slot,
  attendeeIds: readonly PersonId[],
  blocksByPerson: ReadonlyMap<PersonId, readonly BusyBlock[]>,
): PlanConflict[] {
  const out: PlanConflict[] = [];
  for (const personId of new Set(attendeeIds)) {
    const block = conflictingBlock(slot, blocksByPerson.get(personId) ?? []);
    if (block) {
      out.push({ personId, block, overlapMinutes: Math.round(overlapMs(slot, block) / 60_000) });
    }
  }
  return out;
}
