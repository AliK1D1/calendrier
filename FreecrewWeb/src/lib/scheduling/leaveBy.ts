/**
 * Story 6 : « Pars du cégep à 15 h 42 ». Heure à laquelle quitter le lieu d'avant pour arriver
 * à temps à un plan (fonctions pures, sans BD ni réseau ; trajet et horloge injectés).
 *
 * - `previousStop` : où je suis juste avant le plan, selon mon horaire du même jour (même règle
 *   que le « lieu avant » de `getFreeWindows` : lieu du dernier bloc fini, la maison s'il n'y a
 *   rien avant ce jour-là).
 * - `transitQueryFor` : quelle question poser à l'API de transport en commun (arriver avant le
 *   plan, ou partir à la fin de mon bloc si je ne peux pas être à l'heure).
 * - `leaveByTime` : heure de départ, arrivée prévue et retard éventuel.
 */
import { formatInTimeZone } from "date-fns-tz";

import { mergeBusyBlocks } from "./freeWindows";
import { addMinutesTo, MS_PER_MINUTE, TIME_ZONE, zonedDayBounds } from "./time";
import type { BusyBlock, PlaceId } from "./types";

/** Où je suis juste avant le plan. */
export interface PreviousStop {
  /** Lieu d'où je pars (lieu du bloc d'avant, ou la maison). */
  placeId: PlaceId;
  /** Fin du bloc d'avant ; `null` s'il n'y a rien avant le plan ce jour-là (je pars de la maison). */
  end: Date | null;
}

/**
 * Lieu où je suis juste avant `planStart` : le bloc (fusionné) qui commence avant le plan, le
 * même jour local, et finit le plus tard. Un bloc qui déborde sur le plan (cours qui finit
 * après son début) compte : `end` est alors après `planStart` (je serai en retard). Sans bloc
 * ce jour-là avant le plan : la maison, `end` nul.
 *
 * `blocks` : MES blocs seulement (jamais ceux des autres), sans le bloc créé par ce plan.
 */
export function previousStop(
  blocks: readonly BusyBlock[],
  planStart: Date,
  homePlaceId: PlaceId,
  timeZone: string = TIME_ZONE,
): PreviousStop {
  const day = formatInTimeZone(planStart, timeZone, "yyyy-MM-dd");
  const dayStart = zonedDayBounds(day, timeZone).start;
  const before = blocks.filter(
    (b) => b.start.getTime() < planStart.getTime() && b.end.getTime() > dayStart.getTime(),
  );
  const last = mergeBusyBlocks(before).at(-1);
  return last ? { placeId: last.endPlaceId, end: last.end } : { placeId: homePlaceId, end: null };
}

/** Question à poser à l'API de transport en commun (une seule des deux heures). */
export type TransitQuery = { arrivalTime: Date } | { departureTime: Date };

/**
 * Arriver au plus tard à `planStart − marge` ; mais si, selon l'estimation, il faudrait partir
 * avant la fin de mon bloc, on demande plutôt le premier trajet qui part à la fin du bloc (pour
 * dire de combien je serai en retard).
 */
export function transitQueryFor(
  planStart: Date,
  previous: PreviousStop,
  estimateMinutes: number,
  bufferMinutes: number,
): TransitQuery {
  const arriveBy = addMinutesTo(planStart, -bufferMinutes);
  const ideal = addMinutesTo(arriveBy, -estimateMinutes);
  if (previous.end && previous.end.getTime() > ideal.getTime()) {
    return { departureTime: previous.end };
  }
  return { arrivalTime: arriveBy };
}

/** Vrai trajet en transport en commun (départ du lieu d'avant, arrivée au lieu du plan). */
export interface TransitTrip {
  departAt: Date;
  arriveAt: Date;
}

export interface LeaveByInput {
  planStart: Date;
  previous: PreviousStop;
  /** Temps de trajet en minutes (API ou estimation), marge non comprise ; 0 = même lieu. */
  travelMinutes: number;
  /** Marge ajoutée au trajet (la même que celle de la recherche). */
  bufferMinutes: number;
  /** Trajet réel en transport en commun pour cette date, s'il est connu. */
  transit?: TransitTrip | null;
  /** Horloge injectée : sert à dire « il est temps de partir ». */
  now?: Date;
}

export type LeaveBy =
  | {
      kind: "go";
      /** Heure à laquelle partir du lieu d'avant. */
      leaveAt: Date;
      /** Arrivée prévue au lieu du plan. */
      arriveAt: Date;
      /** Minutes de retard (0 = à l'heure). */
      lateMinutes: number;
      /** Le trajet réel en transport en commun a servi (sinon : durée et marge). */
      usedTransit: boolean;
      /** L'heure de départ est passée (selon `now`) et le plan n'a pas commencé. */
      timeToGo: boolean;
    }
  | {
      /** Je suis déjà au lieu du plan juste avant (même lieu) : pas de trajet. */
      kind: "there";
      lateMinutes: number;
    };

const minutesLate = (arriveAt: Date, planStart: Date) =>
  Math.max(0, Math.ceil((arriveAt.getTime() - planStart.getTime()) / MS_PER_MINUTE));

/**
 * Heure de départ pour un plan :
 * - trajet réel en transport en commun (s'il part après la fin de mon bloc) : ses heures ;
 * - sinon : départ = début du plan − trajet − marge ; si c'est avant la fin de mon bloc, je
 *   pars à la fin du bloc et j'arrive en retard (jamais une heure impossible).
 */
export function leaveByTime(input: LeaveByInput): LeaveBy {
  const { planStart, previous, bufferMinutes, transit, now } = input;
  if (!Number.isFinite(input.travelMinutes) || input.travelMinutes < 0) {
    throw new Error(`Temps de trajet invalide : ${input.travelMinutes}`);
  }
  if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
    throw new Error(`Marge invalide : ${bufferMinutes}`);
  }
  const travel = Math.ceil(input.travelMinutes);
  const prevEnd = previous.end;

  const result = (leaveAt: Date, arriveAt: Date, usedTransit: boolean): LeaveBy => ({
    kind: "go",
    leaveAt,
    arriveAt,
    lateMinutes: minutesLate(arriveAt, planStart),
    usedTransit,
    timeToGo:
      now !== undefined &&
      now.getTime() >= leaveAt.getTime() &&
      now.getTime() < planStart.getTime(),
  });

  if (
    transit &&
    transit.arriveAt.getTime() > transit.departAt.getTime() &&
    (prevEnd === null || transit.departAt.getTime() >= prevEnd.getTime())
  ) {
    return result(transit.departAt, transit.arriveAt, true);
  }

  if (travel === 0) {
    return { kind: "there", lateMinutes: prevEnd ? minutesLate(prevEnd, planStart) : 0 };
  }

  const ideal = addMinutesTo(planStart, -(travel + bufferMinutes));
  if (prevEnd && prevEnd.getTime() > ideal.getTime()) {
    return result(prevEnd, addMinutesTo(prevEnd, travel), false);
  }
  return result(ideal, addMinutesTo(ideal, travel), false);
}
