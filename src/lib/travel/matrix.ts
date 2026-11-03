/**
 * Vrai temps de trajet (segment 15) : vocabulaire commun aux API de « matrice » de trajets.
 *
 * Une matrice donne, en UN appel, les durées de chaque origine vers chaque destination : on
 * prépare ainsi tous les trajets d'une recherche en quelques appels au lieu d'un par paire.
 */
import type { Place, TravelMode } from "@/lib/scheduling/types";

/** `fetch` injecté (le vrai côté serveur, un faux dans les tests). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Une API qui sait calculer une matrice de durées pour certains modes. */
export interface TravelMatrixSource {
  /** Nom court, pour les journaux et les limites (ex. « openrouteservice »). */
  readonly name: string;
  /** Nombre maximal d'éléments (origines × destinations) par appel. */
  readonly maxElements: number;
  supports(mode: TravelMode): boolean;
  /**
   * Durées en SECONDES : `result[i][j]` de `origins[i]` vers `destinations[j]`, ou `null` si
   * l'API ne trouve pas de trajet. Lève une erreur si l'appel échoue (réseau, quota, réponse
   * inattendue) ; `signal` interrompt l'appel (délai dépassé).
   */
  matrix(
    origins: readonly Place[],
    destinations: readonly Place[],
    mode: TravelMode,
    signal?: AbortSignal,
  ): Promise<(number | null)[][]>;
}

/** Erreur d'une API de trajets (statut HTTP et message court, jamais la clé). */
export class TravelApiError extends Error {
  constructor(
    readonly source: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${source} : ${message}`);
    this.name = "TravelApiError";
  }
}

/** Plus long trajet accepté d'une API (au-delà, la réponse est jugée aberrante). */
export const MAX_API_TRAVEL_SECONDS = 24 * 3600;

/** Durée valide en secondes, ou `null`. */
export function validSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_API_TRAVEL_SECONDS
    ? v
    : null;
}

/** Lit le corps JSON d'une réponse ; lève une `TravelApiError` lisible si le statut est mauvais. */
export async function readJson(source: string, res: Response): Promise<unknown> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new TravelApiError(source, "réponse illisible", res.status);
  }
  if (!res.ok) {
    throw new TravelApiError(source, `HTTP ${res.status} ${errorMessage(body)}`.trim(), res.status);
  }
  return body;
}

/** Message d'erreur d'une réponse ORS (`{error: {message}}` ou `{error: "…"}`) ou Google. */
function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const err = (body as Record<string, unknown>).error;
  if (typeof err === "string") return err.slice(0, 200);
  if (typeof err === "object" && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string") return msg.slice(0, 200);
  }
  return "";
}
