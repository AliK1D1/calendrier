/**
 * Légende de la grille « Mon horaire » : seulement ce qui apparaît dans la semaine affichée.
 * Sans légende, les couleurs (une par lieu, gris Outlook, indigo des calendriers en ligne,
 * pointillés, hachures…) n'étaient expliquées que dans la liste sous la grille.
 * Fonction pure : la page donne les blocs de la semaine.
 */

export type LegendSource =
  "manual" | "ics" | "image" | "study" | "meetup" | "outlook" | "subscription";

export interface LegendBlock {
  source: LegendSource;
  placeId: string | null;
  /** Calendrier abonné : `false` = juste pour voir (ne bloque pas le temps libre). */
  subscription?: { countsAsBusy: boolean };
}

export type LegendKind = "plan" | "etude" | "outlook" | "abonnement" | "abonnement-libre";

export interface ScheduleLegend {
  /** Lieux des blocs « à moi » (cours, travail…), dans l'ordre d'apparition ; `null` = maison. */
  places: (string | null)[];
  /** Autres sortes de blocs présents, dans un ordre fixe. */
  kinds: LegendKind[];
  /** Hachures des heures où je ne sors pas. */
  quiet: boolean;
  /** Séances d'étude proposées (pas encore acceptées). */
  proposedStudy: boolean;
}

const KIND_ORDER: LegendKind[] = ["plan", "etude", "outlook", "abonnement", "abonnement-libre"];

function kindOf(b: LegendBlock): LegendKind | null {
  switch (b.source) {
    case "meetup":
      return "plan";
    case "study":
      return "etude";
    case "outlook":
      return "outlook";
    case "subscription":
      return b.subscription?.countsAsBusy === false ? "abonnement-libre" : "abonnement";
    default:
      return null;
  }
}

export function scheduleLegend(
  blocks: readonly LegendBlock[],
  opts: { quiet: boolean; proposedStudy?: boolean },
): ScheduleLegend {
  const places: (string | null)[] = [];
  const kinds = new Set<LegendKind>();
  for (const b of blocks) {
    const k = kindOf(b);
    if (k) kinds.add(k);
    else if (!places.includes(b.placeId)) places.push(b.placeId);
  }
  return {
    places,
    kinds: KIND_ORDER.filter((k) => kinds.has(k)),
    quiet: opts.quiet,
    proposedStudy: opts.proposedStudy ?? false,
  };
}

/** Vrai s'il y a quelque chose à expliquer (sinon on n'affiche pas de légende). */
export function legendIsEmpty(l: ScheduleLegend): boolean {
  return l.places.length === 0 && l.kinds.length === 0 && !l.quiet && !l.proposedStudy;
}
