/**
 * `FallbackTravelProvider` : vrais temps de trajet quand une API est configurée, estimation
 * maison sinon (segment 15).
 *
 * Fonctionnement :
 * - `prefetch` (avant le calcul) demande aux API, en quelques matrices, les trajets entre les
 *   lieux de la recherche, et les garde dans un cache en mémoire.
 * - `minutes` (pendant le calcul) ne touche JAMAIS au réseau : il rend la valeur de l'API si
 *   elle est en cache, sinon l'estimation (`EstimatedTravelProvider`). Le temps de calcul de
 *   findMeetups et du planificateur ne dépend donc pas de l'API.
 *
 * Bornes de travail (une recherche ne peut pas faire exploser le temps ni le quota) :
 * - au plus `maxCallsPerPrefetch` appels par recherche, lancés en parallèle ;
 * - chaque appel est abandonné après `timeoutMs` (3 s) ;
 * - au plus `maxPlacesPerMode` lieux par mode (les premiers de la liste : maisons, candidats) ;
 * - limites par processus (par minute et par jour) sous les quotas gratuits ;
 * - après une erreur, l'API est mise de côté `cooldownMs` (pas 3 s d'attente à chaque recherche
 *   quand elle est en panne). Tout ce qui n'a pas été obtenu est estimé.
 *
 * Cache : en mémoire du serveur, borné (LRU) et valable 30 jours, par coordonnées arrondies à
 * 4 décimales (≈ 11 m) et mode. Choix de sécurité : seules les réponses des API y entrent,
 * jamais une valeur venant d'un utilisateur, donc personne ne peut « empoisonner » les trajets
 * des autres ; et il n'y a ni table ni migration. Contrepartie : chaque instance du serveur a
 * son cache, perdu au redémarrage (quelques appels de plus, toujours bornés).
 */
import { createTtlCache, type TtlCache } from "@/lib/geocoding/cache";
import { createKeyedLimiter, type KeyedLimiter } from "@/lib/geocoding/rateLimiter";
import {
  EstimatedTravelProvider,
  isSamePlace,
  type TravelPrefetchOptions,
  type TravelPrefetchRequest,
  type TravelTimeProvider,
} from "@/lib/scheduling/travel";
import type { Place, TravelMode } from "@/lib/scheduling/types";

import type { TravelMatrixSource } from "./matrix";

export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_CALLS_PER_PREFETCH = 4;
export const DEFAULT_MAX_PLACES_PER_MODE = 100;
export const DEFAULT_CALLS_PER_MINUTE = 30;
export const DEFAULT_CALLS_PER_DAY = 450;
/**
 * Appels d'API par personne et par jour (toutes API confondues). Une recherche normale en fait
 * au plus 4, et le cache de 30 jours évite de les refaire. Sans cette limite, une seule
 * personne (qui crée des lieux partout, puis relance des recherches) vidait en 15 minutes le
 * quota du jour de tout le monde, et faisait payer des appels Google (revue de sécurité).
 */
export const DEFAULT_CALLS_PER_USER_PER_DAY = 40;
export const DEFAULT_COOLDOWN_MS = 60_000;
export const TRAVEL_CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
export const DEFAULT_TRAVEL_API_CACHE_SIZE = 50_000;

export interface FallbackTravelOptions {
  /** API disponibles (la première qui offre le mode est utilisée). */
  sources: readonly TravelMatrixSource[];
  /** Estimation de repli (défaut : `EstimatedTravelProvider`). */
  estimate?: TravelTimeProvider;
  timeoutMs?: number;
  maxCallsPerPrefetch?: number;
  maxPlacesPerMode?: number;
  /** Appels permis par API et par minute, pour tout le processus. */
  callsPerMinute?: number;
  /** Appels permis par API et par jour (24 h glissantes), pour tout le processus. */
  callsPerDay?: number;
  /** Appels permis par personne (`budgetKey`) et par jour, toutes API confondues. */
  callsPerUserPerDay?: number;
  cooldownMs?: number;
  cacheEntries?: number;
  /** Horloge (ms). Défaut : `Date.now`. */
  now?: () => number;
  /** Journal des erreurs d'API (défaut : `console.warn`). */
  onError?: (error: unknown) => void;
}

/** Résumé du dernier `prefetch` (diagnostic et tests). */
export interface PrefetchStats {
  calls: number;
  failures: number;
  /** Appels nécessaires mais non faits (budget, limite, API mise de côté). */
  skipped: number;
}

interface Job {
  source: TravelMatrixSource;
  mode: TravelMode;
  origins: Place[];
  destinations: Place[];
}

export class FallbackTravelProvider implements TravelTimeProvider {
  private readonly sources: readonly TravelMatrixSource[];
  private readonly estimate: TravelTimeProvider;
  private readonly cache: TtlCache<number>;
  private readonly perMinute: KeyedLimiter;
  private readonly perDay: KeyedLimiter;
  private readonly perUserDay: KeyedLimiter;
  private readonly disabledUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxCalls: number;
  private readonly maxPlaces: number;
  private readonly cooldownMs: number;
  private readonly onError: (error: unknown) => void;
  lastPrefetch: PrefetchStats = { calls: 0, failures: 0, skipped: 0 };

  constructor(options: FallbackTravelOptions) {
    this.sources = options.sources;
    this.estimate = options.estimate ?? new EstimatedTravelProvider();
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxCalls = options.maxCallsPerPrefetch ?? DEFAULT_MAX_CALLS_PER_PREFETCH;
    this.maxPlaces = options.maxPlacesPerMode ?? DEFAULT_MAX_PLACES_PER_MODE;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.onError = options.onError ?? ((e) => console.warn("Temps de trajet (API) :", e));
    this.cache = createTtlCache<number>({
      maxEntries: options.cacheEntries ?? DEFAULT_TRAVEL_API_CACHE_SIZE,
      ttlMs: TRAVEL_CACHE_TTL_MS,
      now: this.now,
    });
    this.perMinute = createKeyedLimiter({
      limit: options.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE,
      windowMs: 60_000,
      now: this.now,
    });
    this.perDay = createKeyedLimiter({
      limit: options.callsPerDay ?? DEFAULT_CALLS_PER_DAY,
      windowMs: 24 * 3600 * 1000,
      now: this.now,
    });
    this.perUserDay = createKeyedLimiter({
      limit: options.callsPerUserPerDay ?? DEFAULT_CALLS_PER_USER_PER_DAY,
      windowMs: 24 * 3600 * 1000,
      now: this.now,
    });
  }

  /**
   * Valeur de l'API si elle a été préparée, sinon l'estimation. Mêmes erreurs que l'estimation
   * (coordonnées invalides, mode inconnu) et même 0 pour un même lieu. Jamais de réseau ici.
   */
  async minutes(from: Place, to: Place, mode: TravelMode): Promise<number> {
    const estimated = await this.estimate.minutes(from, to, mode);
    if (estimated === 0) return 0;
    return this.cache.get(travelCacheKey(from, to, mode)) ?? estimated;
  }

  /** Nombre de trajets venant d'une API en cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  async prefetch(
    requests: readonly TravelPrefetchRequest[],
    options: TravelPrefetchOptions = {},
  ): Promise<void> {
    const stats: PrefetchStats = { calls: 0, failures: 0, skipped: 0 };
    this.lastPrefetch = stats;
    const jobs: Job[] = [];
    for (const request of requests) {
      const source = this.sources.find((s) => s.supports(request.mode));
      if (!source) continue;
      jobs.push(...this.jobsFor(source, request));
    }

    const running: Promise<void>[] = [];
    for (const job of jobs) {
      if (running.length >= this.maxCalls || !this.mayCall(job.source, options.budgetKey)) {
        stats.skipped++;
        continue;
      }
      stats.calls++;
      running.push(
        this.run(job).catch((e: unknown) => {
          stats.failures++;
          this.disabledUntil.set(job.source.name, this.now() + this.cooldownMs);
          this.onError(e);
        }),
      );
    }
    await Promise.all(running);
  }

  /** Blocs origines × destinations encore absents du cache, dans l'ordre d'importance. */
  private jobsFor(source: TravelMatrixSource, request: TravelPrefetchRequest): Job[] {
    const places = uniqueValidPlaces(request.places).slice(0, this.maxPlaces);
    const size = Math.max(1, Math.floor(Math.sqrt(source.maxElements)));
    const chunks: Place[][] = [];
    for (let i = 0; i < places.length; i += size) chunks.push(places.slice(i, i + size));
    const jobs: Job[] = [];
    // (0,0), puis (0,1), (1,0), (1,1)… : les premiers lieux (les plus importants) d'abord.
    for (let k = 0; k < chunks.length; k++) {
      for (let a = 0; a <= k; a++) {
        const pairs =
          a === k
            ? [[k, k]]
            : [
                [a, k],
                [k, a],
              ];
        for (const [i, j] of pairs) {
          const origins = chunks[i as number] ?? [];
          const destinations = chunks[j as number] ?? [];
          if (this.allCached(origins, destinations, request.mode)) continue;
          jobs.push({ source, mode: request.mode, origins, destinations });
        }
      }
    }
    return jobs;
  }

  private allCached(origins: Place[], destinations: Place[], mode: TravelMode): boolean {
    return origins.every((o) =>
      destinations.every(
        (d) => isSamePlace(o, d) || this.cache.get(travelCacheKey(o, d, mode)) !== undefined,
      ),
    );
  }

  /** L'API n'est pas mise de côté, et les limites par minute et par jour le permettent. */
  private mayCall(source: TravelMatrixSource, budgetKey?: string): boolean {
    if ((this.disabledUntil.get(source.name) ?? 0) > this.now()) return false;
    // Limite de la personne d'abord : si elle refuse, les limites globales ne sont pas entamées.
    if (budgetKey !== undefined && !this.perUserDay.tryAcquire(budgetKey)) return false;
    // Vérifie la limite du jour sans la consommer si celle de la minute refuse.
    return this.perMinute.tryAcquire(source.name) && this.perDay.tryAcquire(source.name);
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${job.source.name} : délai de ${this.timeoutMs} ms dépassé`));
      }, this.timeoutMs);
    });
    try {
      const matrix = await Promise.race([
        job.source.matrix(job.origins, job.destinations, job.mode, controller.signal),
        timeout,
      ]);
      job.origins.forEach((o, i) => {
        job.destinations.forEach((d, j) => {
          const seconds = matrix[i]?.[j];
          if (seconds === null || seconds === undefined || isSamePlace(o, d)) return;
          // Au moins 1 min entre deux lieux distincts : 0 veut dire « même lieu » (pas de marge).
          this.cache.set(travelCacheKey(o, d, job.mode), Math.max(1, Math.ceil(seconds / 60)));
        });
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Coordonnée arrondie à 4 décimales (≈ 11 m). */
const round4 = (n: number) => (Math.round(n * 1e4) / 1e4).toFixed(4);

/** Clé du cache : mode et coordonnées arrondies (pas l'identifiant : partagé entre lieux). */
export function travelCacheKey(from: Place, to: Place, mode: TravelMode): string {
  return `${mode}|${round4(from.lat)},${round4(from.lng)}|${round4(to.lat)},${round4(to.lng)}`;
}

/** Lieux aux coordonnées valides, sans doublon de position arrondie, dans l'ordre reçu. */
function uniqueValidPlaces(places: readonly Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
    const key = `${round4(p.lat)},${round4(p.lng)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
