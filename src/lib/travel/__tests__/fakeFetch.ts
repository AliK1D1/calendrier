import type { FetchLike } from "../matrix";

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** Faux `fetch` : enregistre chaque appel et répond avec `handler`. */
export function fakeFetch(
  handler: (call: RecordedCall) => Response | Promise<Response>,
): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body)) as unknown };
    calls.push(call);
    return handler(call);
  };
  return Object.assign(fn, { calls });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Vraie forme d'une réponse ORS /v2/matrix (version 9) : une ligne par source, secondes.
 * `durations` est calculée par `seconds(i, j)` pour la taille demandée.
 */
export function orsResponse(body: unknown, seconds: (i: number, j: number) => number | null) {
  const b = body as { locations: number[][]; sources: number[]; destinations: number[] };
  return {
    durations: b.sources.map((_, i) => b.destinations.map((_, j) => seconds(i, j))),
    destinations: b.destinations.map((k) => ({ location: b.locations[k], snapped_distance: 4.62 })),
    sources: b.sources.map((k) => ({ location: b.locations[k], snapped_distance: 12.1 })),
    metadata: {
      attribution: "openrouteservice.org | OpenStreetMap contributors",
      service: "matrix",
      timestamp: 1762185600000,
      query: {
        locations: b.locations,
        profile: "driving-car",
        profileName: "driving-car",
        responseType: "json",
        sources: b.sources.map(String),
        destinations: b.destinations.map(String),
        metrics: ["duration"],
      },
      engine: {
        version: "9.0.0",
        build_date: "2025-01-21T10:11:37Z",
        graph_date: "2025-10-26T13:23:15Z",
      },
    },
  };
}
