/**
 * Géocodeur Nominatim : validation du texte, cache, limite de 1 requête/s (pour toute l'app),
 * appel HTTP avec User-Agent, lecture de la réponse. `fetch`, horloge et attente sont injectés.
 * Utilisé seulement côté serveur (route /api/geocode) : le navigateur n'appelle jamais
 * Nominatim directement.
 */
import { createTtlCache, type TtlCache } from "./cache";
import {
  buildSearchUrl,
  cacheKey,
  type GeocodeResult,
  NOMINATIM_USER_AGENT,
  normalizeQuery,
  parseSearchResponse,
  type SearchUrlOptions,
} from "./nominatim";
import { createRateLimiter, RateLimitQueueFullError, type RateLimiter } from "./rateLimiter";

/** Causes d'échec, traduites en messages français par la route. */
export type GeocodeErrorCode = "requete" | "occupe" | "indisponible";

export class GeocodeError extends Error {
  constructor(
    readonly code: GeocodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeocoderOptions extends SearchUrlOptions {
  fetch: FetchLike;
  userAgent?: string;
  /** Limiteur partagé ; défaut : 1 requête/s, 10 en attente au maximum. */
  limiter?: RateLimiter;
  /** Cache partagé ; défaut : 500 recherches pendant 24 h. */
  cache?: TtlCache<GeocodeResult[]>;
  /** Délai maximal d'une requête (ms). */
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Geocoder {
  search(rawQuery: unknown): Promise<GeocodeResult[]>;
}

export function createNominatimGeocoder(options: GeocoderOptions): Geocoder {
  const limiter =
    options.limiter ??
    createRateLimiter({
      minIntervalMs: 1000,
      maxQueue: 10,
      now: options.now,
      sleep: options.sleep,
    });
  const cache =
    options.cache ??
    createTtlCache<GeocodeResult[]>({ maxEntries: 500, ttlMs: 24 * 3600_000, now: options.now });
  const userAgent = options.userAgent ?? NOMINATIM_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? 8000;
  // Deux recherches identiques simultanées : une seule requête.
  const inFlight = new Map<string, Promise<GeocodeResult[]>>();

  async function fetchOnce(query: string): Promise<GeocodeResult[]> {
    let response: Response;
    try {
      response = await options.fetch(buildSearchUrl(query, options), {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause : err) : null;
      throw new GeocodeError(
        "indisponible",
        `Service de géocodage injoignable${cause ? ` (${cause.message})` : ""}`,
      );
    }
    if (response.status === 429 || response.status === 503) {
      throw new GeocodeError("occupe", `Nominatim a répondu ${response.status}`);
    }
    if (!response.ok) {
      throw new GeocodeError("indisponible", `Nominatim a répondu ${response.status}`);
    }
    try {
      return parseSearchResponse(await response.json());
    } catch {
      throw new GeocodeError("indisponible", "Réponse de géocodage illisible");
    }
  }

  return {
    async search(rawQuery) {
      const q = normalizeQuery(rawQuery);
      if (!q.ok) throw new GeocodeError("requete", q.error);
      const key = cacheKey(q.query);
      const cached = cache.get(key);
      if (cached) return cached;
      const running = inFlight.get(key);
      if (running) return running;

      const promise = limiter
        .schedule(() => {
          // Une recherche identique a pu finir pendant l'attente.
          const fresh = cache.get(key);
          return fresh ? Promise.resolve(fresh) : fetchOnce(q.query);
        })
        .then((results) => {
          cache.set(key, results);
          return results;
        })
        .catch((err: unknown) => {
          if (err instanceof RateLimitQueueFullError) {
            throw new GeocodeError("occupe", "Trop de recherches en attente");
          }
          throw err;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}
