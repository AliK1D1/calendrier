/**
 * OpenRouteService (https://openrouteservice.org) : marche, vélo et auto, par l'API « matrix »
 * (`POST /v2/matrix/{profil}`). Clé gratuite : 500 matrices par jour, 40 par minute, au plus
 * 3500 éléments (origines × destinations) par appel.
 *
 * Réponse : `{ durations: [[secondes | null, …], …], sources: […], destinations: […],
 * metadata: {…} }`, une ligne par origine. Erreur : `{ error: { code, message } }` ou
 * `{ error: "Rate limit exceeded" }` avec un statut 4xx/5xx.
 */
import type { Place, TravelMode } from "@/lib/scheduling/types";
import type { TravelTimeProvider } from "@/lib/scheduling/travel";

import {
  type FetchLike,
  readJson,
  TravelApiError,
  type TravelMatrixSource,
  validSeconds,
} from "./matrix";

export const ORS_BASE_URL = "https://api.openrouteservice.org";

/** Profils ORS par mode (le transport en commun n'est pas offert par ORS). */
export const ORS_PROFILES: Readonly<Partial<Record<TravelMode, string>>> = {
  walk: "foot-walking",
  bike: "cycling-regular",
  car: "driving-car",
};

export interface OpenRouteServiceOptions {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

const NAME = "openrouteservice";

export class OpenRouteServiceProvider implements TravelMatrixSource, TravelTimeProvider {
  readonly name = NAME;
  readonly maxElements = 3500;

  constructor(private readonly options: OpenRouteServiceOptions) {
    if (!options.apiKey) throw new Error("Clé OpenRouteService manquante.");
  }

  supports(mode: TravelMode): boolean {
    return Object.hasOwn(ORS_PROFILES, mode);
  }

  async matrix(
    origins: readonly Place[],
    destinations: readonly Place[],
    mode: TravelMode,
    signal?: AbortSignal,
  ): Promise<(number | null)[][]> {
    const profile = ORS_PROFILES[mode];
    if (!profile) throw new TravelApiError(NAME, `mode non offert : ${mode}`);
    if (origins.length === 0 || destinations.length === 0) return origins.map(() => []);
    if (origins.length * destinations.length > this.maxElements) {
      throw new TravelApiError(NAME, "trop d'éléments pour un seul appel");
    }
    const url = `${this.options.baseUrl ?? ORS_BASE_URL}/v2/matrix/${profile}`;
    const res = await this.options.fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.options.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildOrsMatrixBody(origins, destinations)),
      signal,
    });
    return parseOrsMatrix(await readJson(NAME, res), origins.length, destinations.length);
  }

  /** Un seul trajet (une matrice 1 × 1). Lève une erreur si l'API ne trouve pas de trajet. */
  async minutes(from: Place, to: Place, mode: TravelMode): Promise<number> {
    const [[seconds]] = await this.matrix([from], [to], mode);
    if (seconds === null || seconds === undefined) throw new TravelApiError(NAME, "aucun trajet");
    return Math.ceil(seconds / 60);
  }
}

/**
 * Corps de la requête : origines puis destinations (ORS attend `[longitude, latitude]`). Quand
 * origines et destinations sont la même liste (bloc carré), les lieux ne sont envoyés qu'une fois.
 */
export function buildOrsMatrixBody(origins: readonly Place[], destinations: readonly Place[]) {
  if (origins === destinations) {
    const all = origins.map((_, i) => i);
    return {
      locations: origins.map((p) => [p.lng, p.lat]),
      sources: all,
      destinations: all,
      metrics: ["duration"],
    };
  }
  return {
    locations: [...origins, ...destinations].map((p) => [p.lng, p.lat]),
    sources: origins.map((_, i) => i),
    destinations: destinations.map((_, j) => origins.length + j),
    metrics: ["duration"],
  };
}

/** Lit `durations` (secondes) ; lève une erreur si la forme ne correspond pas à la demande. */
export function parseOrsMatrix(json: unknown, rows: number, cols: number): (number | null)[][] {
  const durations =
    typeof json === "object" && json !== null
      ? (json as Record<string, unknown>).durations
      : undefined;
  if (!Array.isArray(durations) || durations.length !== rows) {
    throw new TravelApiError(NAME, "réponse inattendue (durations)");
  }
  return durations.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new TravelApiError(NAME, "réponse inattendue (ligne)");
    }
    return row.map(validSeconds);
  });
}
