import { describe, expect, it } from "vitest";

import { EstimatedTravelProvider } from "@/lib/scheduling/travel";

import { createTravelProvider } from "../env";
import { FallbackTravelProvider } from "../fallback";
import { fakeFetch, json } from "./fakeFetch";

describe("createTravelProvider", () => {
  it("sans clé (ou clé vide) : l'estimation d'avant, aucun appel réseau possible", () => {
    const fetch = fakeFetch(() => json({}));
    for (const env of [{}, { ORS_API_KEY: "" }, { ORS_API_KEY: "  ", GOOGLE_MAPS_API_KEY: "" }]) {
      const travel = createTravelProvider(env, fetch);
      expect(travel).toBeInstanceOf(EstimatedTravelProvider);
      expect(travel.prefetch).toBeUndefined();
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it("avec une clé ORS ou Google : repli automatique sur l'estimation", () => {
    const fetch = fakeFetch(() => json({}));
    expect(createTravelProvider({ ORS_API_KEY: "k" }, fetch)).toBeInstanceOf(
      FallbackTravelProvider,
    );
    expect(createTravelProvider({ GOOGLE_MAPS_API_KEY: "g" }, fetch)).toBeInstanceOf(
      FallbackTravelProvider,
    );
  });
});
