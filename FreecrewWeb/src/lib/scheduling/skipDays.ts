/**
 * « Cours annulé cette fois-ci » : annuler UNE occurrence d'un bloc qui revient, sans toucher
 * aux autres semaines. Fonctions pures (sans BD ni React) : les jours annulés sont une liste
 * `skipDays` sur le bloc, et `occursOn` (weeklyBlocks.ts) les ignore partout (grille, recherche
 * de moments, « Je suis libre maintenant »).
 */
import {
  type BlockDays,
  type BlockSpec,
  isRecurring,
  occursOn,
  type ValidationResult,
} from "./weeklyBlocks";

/** Nombre maximal d'occurrences annulées gardées sur un bloc (même limite que la BD). */
export const MAX_SKIP_DAYS = 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valide un jour `yyyy-MM-dd` reçu d'un formulaire (date réelle du calendrier). */
export function validateSkipDay(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string" || !DAY_RE.test(raw)) return { ok: false, error: "Jour invalide." };
  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: "Jour invalide." };
  }
  return { ok: true, value: raw };
}

/**
 * Annule l'occurrence du jour `day` : renvoie la nouvelle liste `skipDays` (triée, sans
 * doublon). Refusé si le bloc est ponctuel, s'il n'a pas lieu ce jour-là ou si le jour est
 * passé. Les jours annulés déjà passés sont retirés au passage (ils ne servent plus), ce qui
 * garde la liste courte ; au-delà de `MAX_SKIP_DAYS` jours à venir, refusé.
 */
export function skipOccurrence(
  block: BlockDays,
  day: string,
  today: string,
): ValidationResult<string[]> {
  if (!isRecurring(block)) {
    return { ok: false, error: "Ce bloc n'a lieu qu'une fois : supprime-le plutôt." };
  }
  if (day < today) return { ok: false, error: "Ce jour est déjà passé." };
  const current = block.skipDays ?? [];
  if (current.includes(day)) return { ok: true, value: prune(current, today) };
  if (!occursOn({ ...block, skipDays: [] }, day)) {
    return { ok: false, error: "Ce bloc n'a pas lieu ce jour-là." };
  }
  const next = prune([...current, day], today);
  if (next.length > MAX_SKIP_DAYS) {
    return { ok: false, error: "Trop d'occurrences annulées pour ce bloc (60 au maximum)." };
  }
  return { ok: true, value: next };
}

/** Rétablit l'occurrence du jour `day` : la nouvelle liste `skipDays` (sans ce jour). */
export function restoreOccurrence(block: BlockDays, day: string): string[] {
  return [...new Set(block.skipDays ?? [])].filter((d) => d !== day).sort();
}

function prune(days: readonly string[], today: string): string[] {
  return [...new Set(days)].filter((d) => d >= today).sort();
}

/** Occurrence annulée à venir, pour la liste « Annulé cette fois-ci » de /horaire. */
export interface SkippedOccurrence<T> {
  block: T;
  day: string;
}

/**
 * Occurrences annulées d'aujourd'hui ou à venir, triées par jour puis heure de début. Un jour
 * annulé qui ne correspond plus au bloc (bloc déplacé à un autre jour de semaine depuis, ou
 * session raccourcie) est ignoré.
 */
export function upcomingSkips<T extends BlockSpec>(
  blocks: readonly T[],
  today: string,
): SkippedOccurrence<T>[] {
  const out: SkippedOccurrence<T>[] = [];
  for (const block of blocks) {
    if (!isRecurring(block)) continue;
    for (const day of new Set(block.skipDays ?? [])) {
      if (day >= today && occursOn({ ...block, skipDays: [] }, day)) out.push({ block, day });
    }
  }
  return out.sort(
    (a, b) => a.day.localeCompare(b.day) || a.block.startMinute - b.block.startMinute,
  );
}
