import { describe, expect, it } from "vitest";

import {
  buildSearchUrl,
  cacheKey,
  normalizeQuery,
  parseSearchResponse,
  QUERY_MAX,
} from "../nominatim";
import { CEGEP_EDOUARD_MONTPETIT } from "./fixtures";

describe("normalizeQuery", () => {
  it("nettoie les espaces et garde les accents", () => {
    expect(normalizeQuery("  Cégep   Édouard-Montpetit ")).toEqual({
      ok: true,
      query: "Cégep Édouard-Montpetit",
    });
  });

  it("refuse un texte trop court, trop long, non textuel ou avec caractères de contrôle", () => {
    expect(normalizeQuery("ab").ok).toBe(false);
    expect(normalizeQuery("x".repeat(QUERY_MAX + 1)).ok).toBe(false);
    expect(normalizeQuery(42).ok).toBe(false);
    expect(normalizeQuery(undefined).ok).toBe(false);
    expect(normalizeQuery("rue\u0000Saint-Denis").ok).toBe(false);
  });

  it("unifie les formes Unicode (NFD → NFC) pour le cache", () => {
    const nfd = "Cégep";
    const r = normalizeQuery(nfd);
    expect(r.ok && r.query).toBe("Cégep");
    expect(cacheKey("CÉGEP Édouard")).toBe(cacheKey("cégep édouard"));
  });
});

describe("buildSearchUrl", () => {
  it("demande du jsonv2 en français, limité au Canada", () => {
    const url = new URL(buildSearchUrl("Cégep Édouard-Montpetit"));
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("q")).toBe("Cégep Édouard-Montpetit");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("countrycodes")).toBe("ca");
    expect(url.searchParams.get("accept-language")).toBe("fr");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("email")).toBe(false);
  });

  it("accepte une autre base et un courriel de contact", () => {
    const url = new URL(
      buildSearchUrl("x y z", { baseUrl: "http://localhost:8080", email: "a@b.ca", limit: 3 }),
    );
    expect(url.host).toBe("localhost:8080");
    expect(url.searchParams.get("email")).toBe("a@b.ca");
    expect(url.searchParams.get("limit")).toBe("3");
  });
});

describe("parseSearchResponse", () => {
  it("lit la vraie réponse pour « Cégep Édouard-Montpetit » : le cégep passe avant les arrêts", () => {
    const results = parseSearchResponse(CEGEP_EDOUARD_MONTPETIT);
    expect(results).toHaveLength(5);
    // Nominatim met le cégep 4e, derrière des arrêts d'autobus : on le remonte en tête.
    expect(results[0]).toEqual({
      id: "node/6736117856",
      name: "Cégep Édouard-Montpetit",
      address: expect.stringContaining("Longueuil"),
      lat: 45.535936,
      lng: -73.49389,
      kind: "Établissement d'enseignement",
    });
    expect(results[0].lat).toBeCloseTo(45.5355, 2);
    expect(results[0].lng).toBeCloseTo(-73.4955, 2);
    // Les arrêts (autobus, vélos) suivent, dans l'ordre de Nominatim.
    expect(results.slice(1).map((r) => r.kind)).toEqual([
      "Arrêt d'autobus",
      "Arrêt d'autobus",
      "Station de vélos",
      "Arrêt d'autobus",
    ]);
  });

  it("sans `name`, prend le début de l'adresse", () => {
    const [r] = parseSearchResponse([
      {
        place_id: 1,
        lat: "45.5",
        lon: "-73.5",
        name: "",
        display_name: "945, Chemin de Chambly, Longueuil",
      },
    ]);
    expect(r.name).toBe("945");
    expect(r.kind).toBeNull();
  });

  it("renvoie une liste vide quand rien n'est trouvé", () => {
    expect(parseSearchResponse([])).toEqual([]);
  });

  it("ignore les éléments incomplets, hors limites ou en double", () => {
    const r = parseSearchResponse([
      null,
      "texte",
      { osm_type: "node", osm_id: 1, lat: "abc", lon: "-73", name: "Mauvais" },
      { osm_type: "node", osm_id: 2, lat: "95", lon: "-73", name: "Hors limites" },
      { osm_type: "node", osm_id: 3, lat: "45.5", lon: "-73.5", name: "", display_name: "" },
      { place_id: 7, lat: 45.5, lon: -73.5, display_name: "Parc, Montréal" },
      { place_id: 7, lat: "45.5", lon: "-73.5", display_name: "Parc, Montréal" },
    ]);
    expect(r).toEqual([
      { id: "place/7", name: "Parc", address: "Parc, Montréal", lat: 45.5, lng: -73.5, kind: null },
    ]);
  });

  it("refuse une réponse qui n'est pas un tableau (ex. erreur JSON)", () => {
    expect(() => parseSearchResponse({ error: "Bad request" })).toThrow();
  });
});
