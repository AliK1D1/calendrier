import type { CSSProperties } from "react";

import type { Weekday } from "@/lib/scheduling/weeklyBlocks";

/**
 * Couleur propre à chaque jour de la semaine dans la grille de l'horaire (lundi = 1), pour
 * distinguer les jours d'un coup d'œil. Les teintes sont dans globals.css (`--jour-1` à
 * `--jour-7`, version claire et sombre). Elles ne servent qu'au fond très pâle de la colonne
 * et au trait en haut du jour : la couleur des blocs (lieu, plan, étude…) ne change pas.
 */
export function dayColorVar(weekday: Weekday): string {
  return `var(--jour-${weekday})`;
}

/** Style à poser sur un élément pour que ses enfants lisent la couleur du jour dans `--jour`. */
export function dayColorStyle(weekday: Weekday): CSSProperties {
  return { "--jour": dayColorVar(weekday) } as CSSProperties;
}
