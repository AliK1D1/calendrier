/**
 * Story 6 : trajets réels en transport en commun pour l'heure de départ d'un plan, avec des
 * bornes (même esprit que `FallbackTravelProvider`) :
 * - chaque appel compte dans la limite d'appels d'API de la personne et dans les limites
 *   globales de Google (`reserve`, revue 15.1) ; refusé = estimation ;
 * - délai de 3 s par appel ; après une erreur, l'API est mise de côté un moment ;
 * - cache en mémoire court (6 h), PAR PERSONNE (la clé commence par son identifiant : le trajet
 *   d'une personne, qui révèle d'où elle part, n'est jamais servi à une autre), par lieux, par
 *   question (arrivée ou départ) et par heure. « Pas de trajet » est aussi gardé.
 *
 * Ne lève jamais d'erreur : `null` = pas de trajet réel (on montre l'estimation).
 */
import { createTtlCache, type TtlCache } from "@/lib/geocoding/cache";
import type { TransitQuery } from "@/lib/scheduling/leaveBy";
import type { Place } from "@/lib/scheduling/types";

import type { TransitRoute } from "./googleRoutes";

export const TRANSIT_ROUTE_TTL_MS = 6 * 3600 * 1000;
export const TRANSIT_ROUTE_CACHE_SIZE = 5000;
export const TRANSIT_ROUTE_TIMEOUT_MS = 3000;
export const TRANSIT_ROUTE_COOLDOWN_MS = 60_000;

export interface TransitRouter {
  /** Trajet réel de `from` à `to` pour `query`, au nom de `budgetKey` ; `null` sinon. */
  route(
    from: Place,
    to: Place,
    query: TransitQuery,
    budgetKey: string,
  ): Promise<TransitRoute | null>;
}

export interface CachedTransitRouterOptions {
  client: {
    transit(
      from: Place,
      to: Place,
      query: TransitQuery,
      signal?: AbortSignal,
    ): Promise<TransitRoute | null>;
  };
  /** Compte un appel pour `budgetKey` ; faux = limite atteinte ou API mise de côté. */
  reserve: (budgetKey: string) => boolean;
  /** Erreur d'appel (journal, mise de côté partagée). */
  onError?: (error: unknown) => void;
  now?: () => number;
  timeoutMs?: number;
  cooldownMs?: number;
  ttlMs?: number;
  cacheEntries?: number;
}

const round4 = (n: number) => (Math.round(n * 1e4) / 1e4).toFixed(4);

/** Clé du cache : la personne d'abord, puis les lieux, la question et l'heure (à la minute). */
export function transitCacheKey(
  budgetKey: string,
  from: Place,
  to: Place,
  query: TransitQuery,
): string {
  const [kind, at] = "arrivalTime" in query ? ["a", query.arrivalTime] : ["d", query.departureTime];
  const minute = Math.floor(at.getTime() / 60_000);
  return `${budgetKey}|${round4(from.lat)},${round4(from.lng)}|${round4(to.lat)},${round4(to.lng)}|${kind}${minute}`;
}

export class CachedTransitRouter implements TransitRouter {
  private readonly cache: TtlCache<{ route: TransitRoute | null }>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;
  private disabledUntil = 0;

  constructor(private readonly options: CachedTransitRouterOptions) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? TRANSIT_ROUTE_TIMEOUT_MS;
    this.cooldownMs = options.cooldownMs ?? TRANSIT_ROUTE_COOLDOWN_MS;
    this.cache = createTtlCache({
      maxEntries: options.cacheEntries ?? TRANSIT_ROUTE_CACHE_SIZE,
      ttlMs: options.ttlMs ?? TRANSIT_ROUTE_TTL_MS,
      now: this.now,
    });
  }

  async route(
    from: Place,
    to: Place,
    query: TransitQuery,
    budgetKey: string,
  ): Promise<TransitRoute | null> {
    const key = transitCacheKey(budgetKey, from, to, query);
    const cached = this.cache.get(key);
    if (cached) return cached.route;
    if (this.disabledUntil > this.now() || !this.options.reserve(budgetKey)) return null;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`google : délai de ${this.timeoutMs} ms dépassé`));
      }, this.timeoutMs);
    });
    try {
      const route = await Promise.race([
        this.options.client.transit(from, to, query, controller.signal),
        timeout,
      ]);
      this.cache.set(key, { route });
      return route;
    } catch (e) {
      this.disabledUntil = this.now() + this.cooldownMs;
      (this.options.onError ?? ((err) => console.warn("Trajet en transport en commun :", err)))(e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
