import { describe, expect, it } from "vitest";

import { PLACES } from "@/lib/scheduling/__tests__/fixtures";
import { estimateTravelMinutes } from "@/lib/scheduling/travel";
import type { Place, TravelMode } from "@/lib/scheduling/types";

import { FallbackTravelProvider, travelCacheKey } from "../fallback";
import { GoogleTransitProvider } from "../googleTransit";
import type { TravelMatrixSource } from "../matrix";
import { OpenRouteServiceProvider } from "../openRouteService";
import { fakeFetch, json, orsResponse } from "./fakeFetch";

const P = [PLACES.cegepEM, PLACES.aliHome, PLACES.udem, PLACES.downtown];
const silent = () => {};

/** ORS simulé : chaque trajet dure 600 s (10 min), sauf la diagonale. */
function orsFake(seconds = 600) {
  const fetch = fakeFetch((c) => json(orsResponse(c.body, (i, j) => (i === j ? 0 : seconds))));
  return { fetch, ors: new OpenRouteServiceProvider({ apiKey: "k", fetch }) };
}

describe("FallbackTravelProvider", () => {
  it("sans préparation : exactement l'estimation, sans aucun appel", async () => {
    const { fetch, ors } = orsFake();
    const travel = new FallbackTravelProvider({ sources: [ors], onError: silent });
    for (const mode of ["walk", "bike", "transit", "car"] as TravelMode[]) {
      expect(await travel.minutes(P[0], P[2], mode)).toBe(estimateTravelMinutes(P[0], P[2], mode));
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it("après préparation : la valeur de l'API (une seule matrice) ; même lieu = 0", async () => {
    const { fetch, ors } = orsFake(1004.6);
    const travel = new FallbackTravelProvider({ sources: [ors], onError: silent });
    await travel.prefetch([{ mode: "car", places: P }]);
    expect(fetch.calls).toHaveLength(1);
    expect(await travel.minutes(P[0], P[2], "car")).toBe(17);
    expect(await travel.minutes(P[2], P[3], "car")).toBe(17);
    expect(await travel.minutes(P[1], P[1], "car")).toBe(0);
    // Autre mode : pas préparé, donc estimé.
    expect(await travel.minutes(P[0], P[2], "walk")).toBe(
      estimateTravelMinutes(P[0], P[2], "walk"),
    );
    // Une deuxième préparation des mêmes lieux ne rappelle pas l'API (cache).
    await travel.prefetch([{ mode: "car", places: P }]);
    expect(fetch.calls).toHaveLength(1);
  });

  it("le cache suit les coordonnées (arrondies), pas l'identifiant", async () => {
    const { ors } = orsFake();
    const travel = new FallbackTravelProvider({ sources: [ors], onError: silent });
    await travel.prefetch([{ mode: "car", places: P }]);
    const copie: Place = { ...P[2], id: "udem-chez-sam", lat: P[2].lat + 0.00001 };
    expect(await travel.minutes(P[0], copie, "car")).toBe(10);
    expect(travelCacheKey(P[0], copie, "car")).toBe(travelCacheKey(P[0], P[2], "car"));
  });

  it("deux lieux distincts à 0 s selon l'API : au moins 1 min (0 = même lieu)", async () => {
    const { ors } = orsFake(0);
    const travel = new FallbackTravelProvider({ sources: [ors], onError: silent });
    await travel.prefetch([{ mode: "walk", places: P }]);
    expect(await travel.minutes(P[0], P[2], "walk")).toBe(1);
  });

  it("transit : Google si sa clé est là, sinon l'estimation", async () => {
    const { ors } = orsFake();
    const gFetch = fakeFetch(() =>
      json([
        { destinationIndex: 1, status: {}, duration: "2412s", condition: "ROUTE_EXISTS" },
        { originIndex: 1, status: {}, duration: "1867s", condition: "ROUTE_EXISTS" },
      ]),
    );
    const google = new GoogleTransitProvider({ apiKey: "g", fetch: gFetch });
    const both = new FallbackTravelProvider({ sources: [ors, google], onError: silent });
    await both.prefetch([{ mode: "transit", places: [P[0], P[2]] }]);
    expect(gFetch.calls).toHaveLength(1);
    expect(await both.minutes(P[0], P[2], "transit")).toBe(41);
    expect(await both.minutes(P[2], P[0], "transit")).toBe(32);

    const orsOnly = new FallbackTravelProvider({ sources: [ors], onError: silent });
    await orsOnly.prefetch([{ mode: "transit", places: [P[0], P[2]] }]);
    expect(orsOnly.lastPrefetch.calls).toBe(0);
    expect(await orsOnly.minutes(P[0], P[2], "transit")).toBe(
      estimateTravelMinutes(P[0], P[2], "transit"),
    );
  });

  it("erreur de l'API : repli sur l'estimation, puis API mise de côté un moment", async () => {
    let t = 0;
    const fetch = fakeFetch(() => json({ error: "Rate limit exceeded" }, 429));
    const errors: unknown[] = [];
    const travel = new FallbackTravelProvider({
      sources: [new OpenRouteServiceProvider({ apiKey: "k", fetch })],
      now: () => t,
      cooldownMs: 60_000,
      onError: (e) => errors.push(e),
    });
    await travel.prefetch([{ mode: "car", places: P }]);
    expect(travel.lastPrefetch).toEqual({ calls: 1, failures: 1, skipped: 0 });
    expect(errors).toHaveLength(1);
    expect(await travel.minutes(P[0], P[2], "car")).toBe(estimateTravelMinutes(P[0], P[2], "car"));

    t = 30_000;
    await travel.prefetch([{ mode: "car", places: P }]);
    expect(fetch.calls).toHaveLength(1);
    expect(travel.lastPrefetch.skipped).toBe(1);

    t = 61_000;
    await travel.prefetch([{ mode: "car", places: P }]);
    expect(fetch.calls).toHaveLength(2);
  });

  it("délai dépassé : abandon après le délai même si l'API ne répond jamais", async () => {
    let aborted = false;
    const hang: TravelMatrixSource = {
      name: "lente",
      maxElements: 3500,
      supports: () => true,
      matrix: (_o, _d, _m, signal) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {}); // ne répond jamais, ignore l'annulation
      },
    };
    const travel = new FallbackTravelProvider({ sources: [hang], timeoutMs: 50, onError: silent });
    const t0 = performance.now();
    await travel.prefetch([{ mode: "bike", places: P }]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(aborted).toBe(true);
    expect(travel.lastPrefetch.failures).toBe(1);
    expect(await travel.minutes(P[0], P[2], "bike")).toBe(
      estimateTravelMinutes(P[0], P[2], "bike"),
    );
  });

  it("budget : au plus N appels par préparation, le reste est estimé", async () => {
    const { fetch, ors } = orsFake();
    const many: Place[] = Array.from({ length: 160 }, (_, i) => ({
      id: `l${i}`,
      name: `Lieu ${i}`,
      lat: 45.4 + i * 0.001,
      lng: -73.6,
    }));
    const travel = new FallbackTravelProvider({
      sources: [ors],
      maxCallsPerPrefetch: 3,
      maxPlacesPerMode: 150,
      onError: silent,
    });
    await travel.prefetch([{ mode: "car", places: many }]);
    // 150 lieux en blocs de 59 → 3 × 3 = 9 matrices nécessaires ; 3 faites.
    expect(fetch.calls).toHaveLength(3);
    expect(travel.lastPrefetch).toEqual({ calls: 3, failures: 0, skipped: 6 });
    for (const c of fetch.calls) {
      const b = c.body as { sources: number[]; destinations: number[] };
      expect(b.sources.length * b.destinations.length).toBeLessThanOrEqual(3500);
    }
    // Les premiers lieux (les plus importants) sont servis par l'API.
    expect(await travel.minutes(many[0], many[1], "car")).toBe(10);
    // Au-delà de maxPlacesPerMode : estimation.
    expect(await travel.minutes(many[0], many[155], "car")).toBe(
      estimateTravelMinutes(many[0], many[155], "car"),
    );
  });

  it("limite par minute partagée par tout le processus", async () => {
    let t = 0;
    const { fetch, ors } = orsFake();
    const travel = new FallbackTravelProvider({
      sources: [ors],
      callsPerMinute: 2,
      now: () => t,
      onError: silent,
    });
    for (let i = 0; i < 4; i++) {
      await travel.prefetch([{ mode: "car", places: [P[0], { ...P[1], lat: 45 + i / 100 }] }]);
    }
    expect(fetch.calls).toHaveLength(2);
    t = 61_000;
    await travel.prefetch([{ mode: "car", places: [P[0], P[3]] }]);
    expect(fetch.calls).toHaveLength(3);
  });

  it("limite par personne et par jour : une personne ne vide pas le quota de tout le monde (revue)", async () => {
    let t = 0;
    const { fetch, ors } = orsFake();
    const travel = new FallbackTravelProvider({
      sources: [ors],
      callsPerUserPerDay: 3,
      now: () => t,
      onError: silent,
    });
    // L'attaquante change de lieux à chaque recherche (cache manqué) : 3 appels, puis estimation.
    for (let i = 0; i < 10; i++) {
      t += 61_000; // hors limite par minute
      await travel.prefetch([{ mode: "car", places: [P[0], { ...P[1], lat: 45 + i / 100 }] }], {
        budgetKey: "attaquante",
      });
    }
    expect(fetch.calls).toHaveLength(3);
    // Quelqu'un d'autre a encore droit aux vrais trajets.
    await travel.prefetch([{ mode: "car", places: [P[2], P[3]] }], { budgetKey: "ali" });
    expect(fetch.calls).toHaveLength(4);
    expect(await travel.minutes(P[2], P[3], "car")).toBe(10);
    // Le lendemain, l'attaquante a de nouveau droit à quelques appels.
    t += 24 * 3600 * 1000;
    await travel.prefetch([{ mode: "car", places: [P[0], { ...P[1], lat: 46 }] }], {
      budgetKey: "attaquante",
    });
    expect(fetch.calls).toHaveLength(5);
  });

  it("mêmes erreurs que l'estimation (coordonnées invalides, mode inconnu)", async () => {
    const { ors } = orsFake();
    const travel = new FallbackTravelProvider({ sources: [ors], onError: silent });
    await expect(travel.minutes({ ...P[0], lat: Number.NaN }, P[1], "car")).rejects.toThrow(
      "Coordonnées invalides",
    );
    await expect(travel.minutes(P[0], P[1], "avion" as TravelMode)).rejects.toThrow(
      "Mode de transport inconnu",
    );
    // Lieux invalides ignorés par la préparation (pas d'appel avec NaN).
    const { fetch, ors: ors2 } = orsFake();
    const other = new FallbackTravelProvider({ sources: [ors2], onError: silent });
    await other.prefetch([{ mode: "car", places: [{ ...P[0], lng: Number.NaN }, P[1], P[2]] }]);
    expect(fetch.calls).toHaveLength(1);
    expect((fetch.calls[0].body as { locations: unknown[] }).locations).toHaveLength(2);
  });
});
