/**
 * « Je suis libre maintenant » (segment 18) : avec qui puis-je me voir dans les prochaines
 * heures ? Fonctions pures : réutilise `findMeetupCandidates` et `findCallSlots` (mêmes
 * trajets, marges, heures de la journée et heures « je ne sors pas » que la recherche du
 * groupe), sur la fenêtre [maintenant, maintenant + horizon].
 */
import { findCallSlots, findMeetupCandidates } from "./findMeetups";
import { ceilToMinutes, localDay } from "./period";
import { TIME_ZONE, addMinutesTo, eachDay, minutesBetween } from "./time";
import type { TravelTimeProvider } from "./travel";
import type { DateRange, DayHours, MeetupProposal, Person, Place, PlaceId } from "./types";

/** Horizon par défaut : les 2 prochaines heures. */
export const FREE_NOW_HORIZON_MINUTES = 120;
/** Durée minimale d'une rencontre « maintenant », par défaut. */
export const FREE_NOW_MIN_DURATION_MINUTES = 30;
/** Marge par défaut ajoutée à chaque trajet (comme la recherche du groupe). */
export const FREE_NOW_BUFFER_MINUTES = 5;

/** Paramètres d'une recherche « maintenant ». */
export interface FreeNowRequest {
  /** Maintenant (injecté). */
  now: Date;
  /** On cherche une rencontre qui tient dans [maintenant, maintenant + horizon] (défaut 120). */
  horizonMinutes?: number;
  /** Durée minimale de la rencontre, en minutes, à l'intérieur de l'horizon (défaut 30). */
  minDurationMinutes?: number;
  /** Marge ajoutée à chaque trajet, en minutes (défaut 5). */
  bufferMinutes?: number;
  /** Heures de la journée où l'on accepte de se voir (défaut de findMeetups : 8 h à 22 h). */
  dayHours?: DayHours;
  /** Lieux favoris des groupes en commun (café, parc…). */
  favoritePlaces?: Place[];
  /** Lieux à essayer (défaut : tous les lieux des participants et les favoris). */
  candidatePlaceIds?: PlaceId[];
  /** Fuseau (défaut : America/Toronto). */
  timeZone?: string;
}

/**
 * Jours locaux couverts par [now, now + horizon] (un ou deux jours ; plus si l'horizon est
 * long).
 */
export function freeNowRange(
  now: Date,
  horizonMinutes: number = FREE_NOW_HORIZON_MINUTES,
  timeZone: string = TIME_ZONE,
): DateRange {
  const end = addMinutesTo(now, horizonMinutes);
  return { from: localDay(now, timeZone), to: localDay(new Date(end.getTime() - 1), timeZone) };
}

/**
 * Coupe une proposition à la fin de l'horizon. `null` si ce qui reste dure moins de
 * `minDurationMinutes` (on peut toujours partir plus tôt : couper la fin reste faisable).
 */
export function clipToHorizon(
  proposal: MeetupProposal,
  horizonEnd: Date,
  minDurationMinutes: number,
): MeetupProposal | null {
  const end = proposal.end.getTime() > horizonEnd.getTime() ? horizonEnd : proposal.end;
  if (minutesBetween(proposal.start, end) < minDurationMinutes) return null;
  return end === proposal.end ? proposal : { ...proposal, end };
}

/** Somme des trajets aller (sans marge) d'une proposition. */
function totalTravelTo(p: MeetupProposal): number {
  return Object.values(p.travelByPerson).reduce((sum, leg) => sum + leg.to, 0);
}

/**
 * Ordre de préférence : le plus tôt d'abord, puis le moins de trajet, puis le plus long, puis
 * l'identifiant du lieu (résultat stable).
 */
export function compareSoon(a: MeetupProposal, b: MeetupProposal): number {
  return (
    a.start.getTime() - b.start.getTime() ||
    totalTravelTo(a) - totalTravelTo(b) ||
    b.end.getTime() - a.end.getTime() ||
    (a.placeId ?? "").localeCompare(b.placeId ?? "")
  );
}

/**
 * La meilleure rencontre possible entre `participants` (en général moi et une autre personne)
 * dans l'horizon : en personne si c'est possible (la plus tôt, puis le moins de trajet), sinon
 * un appel sur un trou commun. `null` si rien ne dure au moins `minDurationMinutes` dans
 * [maintenant arrondi au quart d'heure suivant, maintenant + horizon].
 */
export async function findMeetupSoon(
  participants: readonly Person[],
  request: FreeNowRequest,
  travel: TravelTimeProvider,
): Promise<MeetupProposal | null> {
  const horizon = request.horizonMinutes ?? FREE_NOW_HORIZON_MINUTES;
  const minDuration = request.minDurationMinutes ?? FREE_NOW_MIN_DURATION_MINUTES;
  if (!Number.isFinite(horizon) || horizon <= 0 || horizon > 24 * 60) {
    throw new Error("L'horizon doit être entre 1 minute et 24 heures.");
  }
  if (participants.length < 2) return null;

  const timeZone = request.timeZone ?? TIME_ZONE;
  const notBefore = ceilToMinutes(request.now, 15);
  const horizonEnd = addMinutesTo(request.now, horizon);
  if (minutesBetween(notBefore, horizonEnd) < minDuration) return null;

  const meetupRequest = {
    personIds: participants.map((p) => p.id),
    dates: freeNowRange(request.now, horizon, timeZone),
    minDurationMinutes: minDuration,
    bufferMinutes: request.bufferMinutes ?? FREE_NOW_BUFFER_MINUTES,
    favoritePlaces: request.favoritePlaces,
    candidatePlaceIds: request.candidatePlaceIds,
    dayHours: request.dayHours,
    notBefore,
  };

  const clip = (list: MeetupProposal[]) =>
    list
      .filter((p) => p.start.getTime() < horizonEnd.getTime())
      .flatMap((p) => clipToHorizon(p, horizonEnd, minDuration) ?? [])
      .sort(compareSoon);

  const inPerson = clip(await findMeetupCandidates(participants, meetupRequest, travel));
  if (inPerson.length > 0) return inPerson[0];

  const calls = clip(
    eachDay(meetupRequest.dates.from, meetupRequest.dates.to).flatMap((day) =>
      findCallSlots(participants, meetupRequest, day),
    ),
  );
  return calls[0] ?? null;
}
