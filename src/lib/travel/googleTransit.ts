/**
 * Transport en commun avec Google (facultatif) : Routes API, « Compute Route Matrix »
 * (`POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`), qui remplace
 * l'ancienne Distance Matrix API (fermée aux nouveaux projets). En transport en commun : au
 * plus 100 éléments (origines × destinations) par appel.
 *
 * Réponse : un tableau JSON d'éléments `{ originIndex, destinationIndex, status, condition,
 * duration: "1234s" }`. En JSON, un index 0 peut être omis (valeur par défaut de proto3), et un
 * `status` vide veut dire « OK ». Erreur : `{ error: { code, message, status } }`.
 *
 * Le départ n'est pas précisé : Google prend « maintenant ». Les horaires varient au fil de la
 * journée : c'est une approximation, meilleure que l'estimation à vol d'oiseau.
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

export const GOOGLE_ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/** Champs demandés (obligatoire pour la Routes API ; limite aussi le coût). */
export const GOOGLE_FIELD_MASK = "originIndex,destinationIndex,duration,condition,status";

export interface GoogleTransitOptions {
  apiKey: string;
  fetch: FetchLike;
  url?: string;
}

const NAME = "google";

export class GoogleTransitProvider implements TravelMatrixSource, TravelTimeProvider {
  readonly name = NAME;
  readonly maxElements = 100;

  constructor(private readonly options: GoogleTransitOptions) {
    if (!options.apiKey) throw new Error("Clé Google Maps manquante.");
  }

  supports(mode: TravelMode): boolean {
    return mode === "transit";
  }

  async matrix(
    origins: readonly Place[],
    destinations: readonly Place[],
    mode: TravelMode,
    signal?: AbortSignal,
  ): Promise<(number | null)[][]> {
    if (!this.supports(mode)) throw new TravelApiError(NAME, `mode non offert : ${mode}`);
    if (origins.length === 0 || destinations.length === 0) return origins.map(() => []);
    if (origins.length * destinations.length > this.maxElements) {
      throw new TravelApiError(NAME, "trop d'éléments pour un seul appel");
    }
    const res = await this.options.fetch(this.options.url ?? GOOGLE_ROUTE_MATRIX_URL, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGoogleMatrixBody(origins, destinations)),
      signal,
    });
    return parseGoogleMatrix(await readJson(NAME, res), origins.length, destinations.length);
  }

  /** Un seul trajet (une matrice 1 × 1). Lève une erreur si l'API ne trouve pas de trajet. */
  async minutes(from: Place, to: Place, mode: TravelMode): Promise<number> {
    const [[seconds]] = await this.matrix([from], [to], mode);
    if (seconds === null || seconds === undefined) throw new TravelApiError(NAME, "aucun trajet");
    return Math.ceil(seconds / 60);
  }
}

const waypoint = (p: Place) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
});

export function buildGoogleMatrixBody(origins: readonly Place[], destinations: readonly Place[]) {
  return {
    origins: origins.map(waypoint),
    destinations: destinations.map(waypoint),
    travelMode: "TRANSIT",
  };
}

/** « 1234s » ou « 1234.5s » → secondes ; `null` sinon. */
function parseDuration(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v);
  return m ? validSeconds(Number(m[1])) : null;
}

function index(v: unknown, size: number): number | null {
  const i = v === undefined ? 0 : v;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < size ? i : null;
}

/** Lit le tableau d'éléments ; les paires absentes ou sans trajet restent `null`. */
export function parseGoogleMatrix(json: unknown, rows: number, cols: number): (number | null)[][] {
  if (!Array.isArray(json)) throw new TravelApiError(NAME, "réponse inattendue");
  const out: (number | null)[][] = Array.from({ length: rows }, () =>
    Array<number | null>(cols).fill(null),
  );
  for (const item of json) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const i = index(e.originIndex, rows);
    const j = index(e.destinationIndex, cols);
    if (i === null || j === null) continue;
    const status = e.status as Record<string, unknown> | undefined;
    if (status && typeof status === "object" && status.code !== undefined && status.code !== 0) {
      continue;
    }
    if (e.condition !== undefined && e.condition !== "ROUTE_EXISTS") continue;
    const row = out[i];
    if (row) row[j] = parseDuration(e.duration);
  }
  return out;
}
