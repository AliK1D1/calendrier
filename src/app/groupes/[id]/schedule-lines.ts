import { format, parseISO } from "date-fns";
import { frCA } from "date-fns/locale";

import { type BlockSpec, formatClockFr, WEEKDAY_SHORT } from "@/lib/scheduling/weeklyBlocks";

/** Une ligne d'horaire affichée dans la page du groupe. */
export interface ScheduleLine {
  key: string;
  when: string;
  title: string;
  titleHidden: boolean;
  place: string | null;
}

/**
 * Blocs d'un membre → lignes lisibles : les blocs hebdomadaires encore en vigueur (par jour
 * puis heure), puis les blocs ponctuels de la période `range`. Le titre est déjà masqué
 * (« Occupé ») par la base si la personne l'a choisi.
 */
export function scheduleLines(
  blocks: { spec: BlockSpec; titleHidden: boolean }[],
  placeNames: Record<string, string>,
  range: { from: string; to: string },
): ScheduleLine[] {
  const hours = (b: BlockSpec) => `${formatClockFr(b.startMinute)} – ${formatClockFr(b.endMinute)}`;
  const line = (b: BlockSpec, hidden: boolean, when: string): ScheduleLine => ({
    key: b.id ?? `${when}-${b.title}`,
    when,
    title: b.title || "Occupé",
    titleHidden: hidden,
    place: b.placeId ? (placeNames[b.placeId] ?? null) : null,
  });

  const weekly = blocks
    .filter(
      ({ spec }) => spec.weekday !== null && (!spec.validUntil || spec.validUntil >= range.from),
    )
    .sort(
      (a, b) =>
        (a.spec.weekday ?? 0) - (b.spec.weekday ?? 0) || a.spec.startMinute - b.spec.startMinute,
    )
    .map(({ spec, titleHidden }) =>
      line(spec, titleHidden, `${WEEKDAY_SHORT[spec.weekday ?? 1]} ${hours(spec)}`),
    );
  const oneOff = blocks
    .filter(
      ({ spec }) =>
        spec.weekday === null &&
        spec.validFrom !== null &&
        spec.validFrom >= range.from &&
        spec.validFrom <= range.to,
    )
    .sort(
      (a, b) =>
        (a.spec.validFrom ?? "").localeCompare(b.spec.validFrom ?? "") ||
        a.spec.startMinute - b.spec.startMinute,
    )
    .map(({ spec, titleHidden }) =>
      line(
        spec,
        titleHidden,
        `${format(parseISO(spec.validFrom ?? range.from), "EEE d MMM", { locale: frCA })} ${hours(spec)}`,
      ),
    );
  return [...weekly, ...oneOff];
}
