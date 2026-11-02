/**
 * Mise en page de la grille hebdomadaire de /horaire (fonctions pures, sans React) :
 * position verticale des blocs dans la plage affichée (7 h → 23 h) et colonnes côte à côte
 * quand des blocs se chevauchent.
 */
import { GRID_STEP_MINUTES, MINUTES_PER_DAY } from "./weeklyBlocks";

/** Plage affichée par la grille, en minutes depuis minuit (heure locale). */
export interface GridRange {
  start: number;
  end: number;
}

/** 7 h → 23 h, comme demandé dans le plan. */
export const DEFAULT_GRID_RANGE: GridRange = { start: 7 * 60, end: 23 * 60 };

export interface GridInterval {
  id: string;
  startMinute: number;
  endMinute: number;
}

/** Un bloc placé dans la grille. Les positions sont des fractions (0 à 1) de la hauteur. */
export interface PlacedInterval<T extends GridInterval> {
  item: T;
  top: number;
  height: number;
  /** Colonne du bloc (0 = la plus à gauche) parmi `lanes` colonnes. */
  lane: number;
  lanes: number;
  /** Le bloc commence avant la plage affichée (ou finit après) : il est coupé. */
  cutTop: boolean;
  cutBottom: boolean;
}

/**
 * Place les blocs d'une journée dans la grille. Les blocs entièrement hors de la plage
 * affichée sont renvoyés à part (`hidden`) pour être listés sous la grille. Les blocs qui se
 * chevauchent sont mis côte à côte : chaque groupe de blocs qui se chevauchent (directement
 * ou en chaîne) partage le même nombre de colonnes.
 */
export function layoutDay<T extends GridInterval>(
  items: readonly T[],
  range: GridRange = DEFAULT_GRID_RANGE,
): { placed: PlacedInterval<T>[]; hidden: T[] } {
  const span = range.end - range.start;
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const it of items) {
    if (it.endMinute <= range.start || it.startMinute >= range.end) hidden.push(it);
    else visible.push(it);
  }
  visible.sort(
    (a, b) =>
      a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.id.localeCompare(b.id),
  );

  const placed: PlacedInterval<T>[] = [];
  let cluster: PlacedInterval<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const it of visible) {
    if (it.startMinute >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= it.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMinute);
    } else {
      laneEnds[lane] = it.endMinute;
    }
    clusterEnd = Math.max(clusterEnd, it.endMinute);
    const top = Math.max(it.startMinute, range.start);
    const bottom = Math.min(it.endMinute, range.end);
    cluster.push({
      item: it,
      top: (top - range.start) / span,
      height: (bottom - top) / span,
      lane,
      lanes: 1,
      cutTop: it.startMinute < range.start,
      cutBottom: it.endMinute > range.end,
    });
  }
  closeCluster();
  return { placed, hidden };
}

/**
 * Minute (heure locale) visée par un point de la grille : `fraction` = position verticale
 * (0 = haut, 1 = bas), arrondie vers le bas au pas de 15 min et bornée à la plage.
 */
export function minuteAtFraction(
  fraction: number,
  range: GridRange = DEFAULT_GRID_RANGE,
  step: number = GRID_STEP_MINUTES,
): number {
  const f = Math.min(Math.max(fraction, 0), 1);
  const raw = range.start + f * (range.end - range.start);
  const snapped = Math.floor(raw / step) * step;
  return Math.min(Math.max(snapped, range.start), range.end - step);
}

/**
 * Bloc créé par un clic-glisser entre deux points de la grille (dans n'importe quel sens).
 * Un simple clic (ou un glissé de moins d'un pas) donne un bloc d'une heure (`defaultMinutes`),
 * raccourci s'il dépasse la fin de la plage.
 */
export function selectionFromDrag(
  fromFraction: number,
  toFraction: number,
  range: GridRange = DEFAULT_GRID_RANGE,
  defaultMinutes = 60,
  step: number = GRID_STEP_MINUTES,
): { startMinute: number; endMinute: number } {
  const a = minuteAtFraction(fromFraction, range, step);
  const b = minuteAtFraction(toFraction, range, step);
  const start = Math.min(a, b);
  const endSlot = Math.max(a, b) + step;
  const end = endSlot - start <= step ? start + defaultMinutes : endSlot;
  return { startMinute: start, endMinute: Math.min(end, range.end, MINUTES_PER_DAY) };
}

/** Heures choisissables dans le formulaire (« HH:mm » toutes les 15 min, 00:00 → 24:00). */
export function clockOptions(step: number = GRID_STEP_MINUTES): number[] {
  const out: number[] = [];
  for (let m = 0; m <= MINUTES_PER_DAY; m += step) out.push(m);
  return out;
}
