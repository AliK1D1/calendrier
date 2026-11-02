import { max as maxDate, min as minDate } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { TIME_ZONE, addMinutesTo, eachDay, zonedTime } from "./time";
import type { BusyBlock, DayHours, FreeWindow, Person, PlaceId } from "./types";

/** Options de calcul des fenêtres libres. */
export interface FreeWindowOptions {
  /**
   * Heures de la journée considérées, en heure locale (ex. 08:00 → 22:00). En dehors, la
   * personne est considérée comme indisponible (nuit, « je ne veux pas »). Appliquées à
   * chaque jour local couvert par [dayStart, dayEnd]. Par défaut : toute la plage.
   */
  dayHours?: DayHours;
  /**
   * Fusion des blocs : deux blocs séparés par un trou de cette durée ou moins (en minutes)
   * sont fusionnés. Les blocs qui se chevauchent ou se touchent sont toujours fusionnés.
   * Défaut : 0.
   */
  mergeGapMinutes?: number;
  /** Blocs occupés supplémentaires (plans confirmés, séances d'étude acceptées…). */
  extraBusyBlocks?: BusyBlock[];
  /** Fuseau horaire pour interpréter `dayHours`. Défaut : America/Toronto. */
  timeZone?: string;
}

/** Intervalle occupé après fusion, avec le lieu au début et le lieu à la fin. */
interface MergedBusy {
  start: Date;
  end: Date;
  /** Lieu du premier bloc (là où la personne doit arriver). */
  startPlaceId: PlaceId;
  /** Lieu du bloc qui finit le plus tard (là d'où la personne repart). */
  endPlaceId: PlaceId;
}

/**
 * Trie les blocs et fusionne ceux qui se chevauchent, se touchent ou sont séparés d'au
 * plus `mergeGapMinutes`. Les blocs de durée nulle ou négative sont ignorés.
 */
export function mergeBusyBlocks(blocks: readonly BusyBlock[], mergeGapMinutes = 0): MergedBusy[] {
  const sorted = blocks
    .filter((b) => b.end.getTime() > b.start.getTime())
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

  const merged: MergedBusy[] = [];
  for (const b of sorted) {
    const last = merged.at(-1);
    if (last && b.start.getTime() <= addMinutesTo(last.end, mergeGapMinutes).getTime()) {
      // Le lieu de fin est celui du bloc qui se termine le plus tard (à égalité : le dernier).
      if (b.end.getTime() >= last.end.getTime()) {
        last.end = b.end;
        last.endPlaceId = b.placeId;
      }
    } else {
      merged.push({ start: b.start, end: b.end, startPlaceId: b.placeId, endPlaceId: b.placeId });
    }
  }
  return merged;
}

/**
 * Découpe [rangeStart, rangeEnd] en segments selon les heures de la journée considérées
 * (un segment par jour local), ou renvoie la plage entière si `dayHours` est absent.
 */
export function daySegments(
  rangeStart: Date,
  rangeEnd: Date,
  dayHours: DayHours | undefined,
  timeZone: string = TIME_ZONE,
): Array<{ start: Date; end: Date }> {
  if (rangeEnd.getTime() <= rangeStart.getTime()) return [];
  if (!dayHours) return [{ start: rangeStart, end: rangeEnd }];

  const firstDay = formatInTimeZone(rangeStart, timeZone, "yyyy-MM-dd");
  const lastDay = formatInTimeZone(new Date(rangeEnd.getTime() - 1), timeZone, "yyyy-MM-dd");

  const segments: Array<{ start: Date; end: Date }> = [];
  for (const day of eachDay(firstDay, lastDay)) {
    const start = maxDate([rangeStart, zonedTime(day, dayHours.start, timeZone)]);
    const end = minDate([rangeEnd, zonedTime(day, dayHours.end, timeZone)]);
    if (end.getTime() > start.getTime()) segments.push({ start, end });
  }
  return segments;
}

/**
 * Fenêtres libres d'une personne entre `dayStart` et `dayEnd`.
 *
 * - Les blocs sont triés et fusionnés (chevauchements, blocs collés).
 * - Une fenêtre libre est un trou entre deux blocs, à l'intérieur de [dayStart, dayEnd] et des
 *   heures de la journée considérées (`options.dayHours`).
 * - `placeBeforeId` = lieu du bloc précédent, ou la maison s'il n'y en a pas dans le segment.
 * - `placeAfterId` = lieu du bloc suivant, ou la maison s'il n'y en a pas dans le segment.
 * - Les fenêtres de durée nulle sont ignorées.
 *
 * Les durées sont des durées réelles : une journée de changement d'heure dure 23 ou 25 h.
 */
export function getFreeWindows(
  person: Person,
  dayStart: Date,
  dayEnd: Date,
  options: FreeWindowOptions = {},
): FreeWindow[] {
  const { dayHours, mergeGapMinutes = 0, extraBusyBlocks = [], timeZone = TIME_ZONE } = options;
  const home = person.homePlaceId;
  const merged = mergeBusyBlocks([...person.busyBlocks, ...extraBusyBlocks], mergeGapMinutes);

  const windows: FreeWindow[] = [];
  for (const seg of daySegments(dayStart, dayEnd, dayHours, timeZone)) {
    let cursor = seg.start;
    let placeBefore: PlaceId = home;

    for (const busy of merged) {
      if (busy.end.getTime() <= seg.start.getTime()) continue; // avant le segment
      if (busy.start.getTime() >= seg.end.getTime()) break; // après le segment

      if (busy.start.getTime() > cursor.getTime()) {
        windows.push({
          start: cursor,
          end: busy.start,
          placeBeforeId: placeBefore,
          placeAfterId: busy.startPlaceId,
        });
      }
      if (busy.end.getTime() > cursor.getTime()) cursor = busy.end;
      placeBefore = busy.endPlaceId;
    }

    if (seg.end.getTime() > cursor.getTime()) {
      windows.push({ start: cursor, end: seg.end, placeBeforeId: placeBefore, placeAfterId: home });
    }
  }
  return windows;
}
