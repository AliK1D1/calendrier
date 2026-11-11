import { describe, expect, it, vi } from "vitest";

import { createNominatimGeocoder, GeocodeError, type FetchLike } from "../geocoder";
import { NOMINATIM_USER_AGENT } from "../nominatim";
import { CEGEP_EDOUARD_MONTPETIT, jsonResponse } from "./fixtures";

function setup(fetchImpl: FetchLike) {
  let t = 1_000_000;
  const starts: number[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    starts.push(t);
    return fetchImpl(url, init);
  });
  const geocoder = createNominatimGeocoder({
    fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  return { geocoder, fetch, starts, advance: (ms: number) => (t += ms) };
}

describe("createNominatimGeocoder", () => {
  it("trouve « Cégep Édouard-Montpetit » à Longueuil, avec le User-Agent de l'app", async () => {
    const { geocoder, fetch } = setup(async () => jsonResponse(CEGEP_EDOUARD_MONTPETIT));
    const [premier] = await geocoder.search("Cégep Édouard-Montpetit");
    expect(premier.name).toBe("Cégep Édouard-Montpetit");
    expect(premier.kind).toBe("Établissement d'enseignement");
    expect(premier.address).toContain("Longueuil");
    expect(premier.lat).toBeCloseTo(45.5355, 2);
    expect(premier.lng).toBeCloseTo(-73.4955, 2);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get("q")).toBe("Cégep Édouard-Montpetit");
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(NOMINATIM_USER_AGENT);
    expect(NOMINATIM_USER_AGENT).toMatch(/^Freecrew\/\d/);
  });

  it("met en cache : la même recherche (casse, espaces) ne refait pas de requête", async () => {
    const { geocoder, fetch } = setup(async () => jsonResponse(CEGEP_EDOUARD_MONTPETIT));
    await geocoder.search("Cégep Édouard-Montpetit");
    const again = await geocoder.search("  cégep   ÉDOUARD-MONTPETIT ");
    expect(again[0].name).toBe("Cégep Édouard-Montpetit");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fusionne deux recherches identiques simultanées", async () => {
    const { geocoder, fetch } = setup(async () => jsonResponse(CEGEP_EDOUARD_MONTPETIT));
    const [a, b] = await Promise.all([
      geocoder.search("Cégep Édouard-Montpetit"),
      geocoder.search("cégep édouard-montpetit"),
    ]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("respecte 1 requête/s entre des recherches différentes", async () => {
    const { geocoder, starts } = setup(async () => jsonResponse([]));
    await Promise.all([
      geocoder.search("rue Sherbrooke"),
      geocoder.search("parc La Fontaine"),
      geocoder.search("métro Longueuil"),
    ]);
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });

  it("refuse une recherche invalide sans appeler Nominatim", async () => {
    const { geocoder, fetch } = setup(async () => jsonResponse([]));
    await expect(geocoder.search("ab")).rejects.toMatchObject({ code: "requete" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("traduit les erreurs : 429 → occupé, 500 / réseau / JSON illisible → indisponible", async () => {
    const cas: [FetchLike, string][] = [
      [async () => jsonResponse({ error: "Too many" }, 429), "occupe"],
      [async () => new Response("erreur", { status: 500 }), "indisponible"],
      [
        async () => {
          throw new TypeError("fetch failed");
        },
        "indisponible",
      ],
      [async () => new Response("<html>", { status: 200 }), "indisponible"],
    ];
    for (const [impl, code] of cas) {
      const { geocoder } = setup(impl);
      const err = await geocoder.search("Cégep Édouard-Montpetit").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe(code);
    }
  });

  it("ne met pas une erreur en cache : la recherche suivante réessaie", async () => {
    let first = true;
    const { geocoder, fetch } = setup(async () => {
      if (first) {
        first = false;
        return new Response("", { status: 503 });
      }
      return jsonResponse(CEGEP_EDOUARD_MONTPETIT);
    });
    await expect(geocoder.search("Cégep Édouard-Montpetit")).rejects.toMatchObject({
      code: "occupe",
    });
    await expect(geocoder.search("Cégep Édouard-Montpetit")).resolves.toHaveLength(5);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
