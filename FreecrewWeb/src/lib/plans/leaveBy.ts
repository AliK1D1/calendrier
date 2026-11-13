/**
 * Story 6 : « Pars du cégep à 15 h 42 » sur mes plans. Assemble les données (mon horaire, mes
 * lieux, le lieu du plan), le trajet (API ou estimation) et la logique pure de
 * `src/lib/scheduling/leaveBy.ts`, puis met le résultat en mots.
 *
 * Aucun accès BD ici (les lectures sont dans `leaveByQueries.ts`) ; trajets et horloge injectés.
 *
 * Vie privée : seul MON horaire sert (mes blocs, mes lieux) et le résultat n'est montré qu'à
 * moi. Le lieu d'avant des autres n'est jamais lu ni affiché.
 */
import { formatInTimeZone } from "date-fns-tz";

import { type BusyBlockInput, expandBusyBlocks } from "@/lib/db/convert";
import type { Locale } from "@/lib/i18n/config";
import { formatInstantClock } from "@/lib/i18n/format";
import { getMessages } from "@/lib/i18n/messages";
import { DEFAULT_BUFFER_MINUTES } from "@/lib/meetups/search";
import { type LeaveBy, leaveByTime, previousStop, transitQueryFor } from "@/lib/scheduling/leaveBy";
import { TIME_ZONE } from "@/lib/scheduling/time";
import type { TravelTimeProvider } from "@/lib/scheduling/travel";
import type { Place, TravelMode } from "@/lib/scheduling/types";
import type { TransitLeg } from "@/lib/travel/googleRoutes";
import type { TransitRouter } from "@/lib/travel/transitRouter";

import type { PlanView } from "./view";

/** Plans calculés au plus par page (les plus proches) : borne les appels d'API. */
export const MAX_LEAVE_BY_PLANS = 6;
/** Au-delà de ce nombre de jours, pas d'horaire réel de transport en commun (estimation). */
export const TRANSIT_HORIZON_DAYS = 7;
/** Lignes de transport en commun affichées au plus. */
const MAX_LEGS_SHOWN = 3;

/** Heure de départ telle qu'affichée (sérialisable, envoyée au navigateur). */
export interface LeaveByView {
  mode: TravelMode;
  /** « Pars de « Cégep » à 15 h 42 », « Tu es déjà sur place »… */
  main: string;
  /** « Arrivée prévue 16 h 05 », ou `null`. */
  detail: string | null;
  /** « Bus 51 à 15 h 42 (arrêt Longueuil), puis Métro 4 à 15 h 58 », ou `null`. */
  transit: string | null;
  /** « Tu arriveras vers 16 h 12, 7 min en retard. », ou `null`. */
  warning: string | null;
  /** « C'est l'heure de partir ! », ou `null`. */
  urgent: string | null;
  /** « Estimation : … », ou `null` (trajet réel). */
  note: string | null;
  /** Heure de départ (ISO), ou `null` (déjà sur place). */
  leaveAt: string | null;
  lateMinutes: number;
}

/** Bloc de mon horaire, avec le plan qui l'a créé (pour ne pas compter le plan lui-même). */
export type LeaveByBlock = BusyBlockInput & { meetup_plan_id?: string | null };

export interface LeaveByData {
  homePlaceId: string;
  travelMode: TravelMode;
  /** MES blocs seulement. */
  blocks: readonly LeaveByBlock[];
  /** Mes lieux et ceux des plans (lisibles par la RLS). */
  places: readonly Place[];
}

/** Trajets injectés : estimation ou API ; `isMeasured` dit si la valeur vient d'une API. */
export type LeaveByTravel = TravelTimeProvider & {
  isMeasured?(from: Place, to: Place, mode: TravelMode): boolean;
};

export interface LeaveByDeps {
  travel: LeaveByTravel;
  transit: TransitRouter | null;
  /** Ma personne (limite d'appels d'API par personne, cache par personne). */
  budgetKey: string;
  now: Date;
  bufferMinutes?: number;
  /** Langue des phrases (français par défaut). */
  locale?: Locale;
}

/** Plan pour lequel calculer une heure de départ. */
export interface LeaveByTarget {
  id: string;
  placeId: string;
  start: Date;
}

/**
 * Mes plans en personne à venir où je vais (proposés par moi, ou où je suis invité·e sans
 * avoir refusé), pas encore commencés, les plus proches d'abord. Un appel (pas de lieu) ou un
 * lieu écrit à la main (pas de coordonnées) n'a pas d'heure de départ.
 */
export function leaveByTargets(
  views: readonly PlanView[],
  now: Date,
  max = MAX_LEAVE_BY_PLANS,
): LeaveByTarget[] {
  return views
    .filter(
      (v) =>
        v.state === "upcoming" &&
        v.placeId !== null &&
        (v.isMine || (v.invited && v.myResponse !== "no")) &&
        new Date(v.startsAt).getTime() > now.getTime(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, max)
    .map((v) => ({ id: v.id, placeId: v.placeId as string, start: new Date(v.startsAt) }));
}

function transitLine(legs: readonly TransitLeg[], locale: Locale): string | null {
  if (legs.length === 0) return null;
  const t = getMessages(locale).plans.leave;
  const shown = legs.slice(0, MAX_LEGS_SHOWN).map((l) => {
    const name = l.line ? `${l.vehicle} ${l.line}` : l.vehicle;
    const stop = l.stop ? t.stop(l.stop) : "";
    return t.legAt(name, formatInstantClock(l.departAt, locale), stop);
  });
  const more = legs.length > MAX_LEGS_SHOWN ? "…" : "";
  return shown.join(t.then) + more;
}

/** Met un résultat en mots (fonction pure). */
export function describeLeaveBy(input: {
  result: LeaveBy;
  mode: TravelMode;
  fromName: string;
  fromHome: boolean;
  /** Fin du bloc d'avant (pour « déjà sur place » en retard). */
  previousEnd: Date | null;
  legs: readonly TransitLeg[];
  estimate: boolean;
  /** Langue des phrases (français par défaut). */
  locale?: Locale;
}): LeaveByView {
  const { result, mode, fromName, fromHome, previousEnd, legs, estimate } = input;
  const locale = input.locale ?? "fr";
  const t = getMessages(locale).plans.leave;
  const clock = (instant: Date) => formatInstantClock(instant, locale);
  const from = fromHome ? t.fromHome : t.fromPlace(fromName);
  const late = (arrive: Date, n: number) => t.late(clock(arrive), n);

  if (result.kind === "there") {
    return {
      mode,
      main: fromHome ? t.planAtHome : t.alreadyThere(fromName),
      detail: null,
      transit: null,
      warning: result.lateMinutes > 0 && previousEnd ? late(previousEnd, result.lateMinutes) : null,
      urgent: null,
      note: null,
      leaveAt: null,
      lateMinutes: result.lateMinutes,
    };
  }

  const isLate = result.lateMinutes > 0;
  const noteText = !estimate ? null : mode === "transit" ? t.estimateTransit : t.estimate;
  return {
    mode,
    main: isLate
      ? t.leaveFrom(from, clock(result.leaveAt))
      : t.leaveAt(from, clock(result.leaveAt)),
    detail: isLate ? null : t.arrival(clock(result.arriveAt)),
    transit: result.usedTransit ? transitLine(legs, locale) : null,
    warning: isLate ? late(result.arriveAt, result.lateMinutes) : null,
    urgent: result.timeToGo ? t.timeToGo : null,
    note: noteText,
    leaveAt: result.leaveAt.toISOString(),
    lateMinutes: result.lateMinutes,
  };
}

/**
 * Heures de départ de mes prochains plans, par identifiant de plan. Un plan sans calcul
 * possible (lieu inconnu, erreur) est simplement absent. Ne lève pas pour un plan isolé.
 */
export async function computeLeaveBy(
  targets: readonly LeaveByTarget[],
  data: LeaveByData,
  deps: LeaveByDeps,
): Promise<Map<string, LeaveByView>> {
  const out = new Map<string, LeaveByView>();
  const places = new Map(data.places.map((p) => [p.id, p]));
  const home = places.get(data.homePlaceId);
  if (!home || targets.length === 0) return out;
  const buffer = deps.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const mode = data.travelMode;

  // Lieu d'un bloc inconnu (supprimé, illisible) : la maison (même règle que `toPeople`).
  const blocks = data.blocks.map((b) =>
    b.place_id && !places.has(b.place_id) ? { ...b, place_id: null } : b,
  );

  const prepared = targets.flatMap((t) => {
    const to = places.get(t.placeId);
    if (!to) return [];
    const day = formatInTimeZone(t.start, TIME_ZONE, "yyyy-MM-dd");
    const mine = expandBusyBlocks(
      blocks.filter((b) => b.meetup_plan_id !== t.id),
      { from: day, to: day },
      data.homePlaceId,
    );
    const previous = previousStop(mine, t.start, data.homePlaceId);
    const from = places.get(previous.placeId) ?? home;
    return [{ target: t, to, from, previous: { ...previous, placeId: from.id } }];
  });

  // Marche, vélo, auto : une seule préparation (une matrice) pour tous les trajets.
  if (mode !== "transit" && deps.travel.prefetch && prepared.length > 0) {
    const all = new Map<string, Place>();
    for (const p of prepared) {
      all.set(p.from.id, p.from);
      all.set(p.to.id, p.to);
    }
    await deps.travel.prefetch([{ mode, places: [...all.values()] }], {
      budgetKey: deps.budgetKey,
    });
  }

  const horizon = deps.now.getTime() + TRANSIT_HORIZON_DAYS * 86_400_000;
  await Promise.all(
    prepared.map(async ({ target, to, from, previous }) => {
      try {
        const estimateMinutes = await deps.travel.minutes(from, to, mode);
        let measured = deps.travel.isMeasured?.(from, to, mode) ?? false;
        let transit = null;
        let legs: TransitLeg[] = [];
        if (
          mode === "transit" &&
          estimateMinutes > 0 &&
          deps.transit &&
          target.start.getTime() <= horizon
        ) {
          const query = transitQueryFor(target.start, previous, estimateMinutes, buffer);
          const route = await deps.transit.route(from, to, query, deps.budgetKey);
          if (route) {
            transit = { departAt: route.departAt, arriveAt: route.arriveAt };
            legs = route.legs;
          }
        }
        const result = leaveByTime({
          planStart: target.start,
          previous,
          travelMinutes: estimateMinutes,
          bufferMinutes: buffer,
          transit,
          now: deps.now,
        });
        if (result.kind === "go" && result.usedTransit) measured = true;
        // En transport en commun, seul un horaire réel compte comme « pas une estimation ».
        if (mode === "transit" && !(result.kind === "go" && result.usedTransit)) measured = false;
        out.set(
          target.id,
          describeLeaveBy({
            result,
            mode,
            fromName: from.name,
            fromHome: from.id === data.homePlaceId,
            previousEnd: previous.end,
            legs,
            estimate: !measured,
            locale: deps.locale,
          }),
        );
      } catch (e) {
        console.warn("Heure de départ :", e);
      }
    }),
  );
  return out;
}

/** Ajoute les heures de départ aux plans (les autres plans restent sans). */
export function withLeaveBy(
  views: readonly PlanView[],
  leaveBy: ReadonlyMap<string, LeaveByView>,
): PlanView[] {
  return views.map((v) => {
    const lb = leaveBy.get(v.id);
    return lb ? { ...v, leaveBy: lb } : v;
  });
}
