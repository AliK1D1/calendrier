import { describe, expect, it } from "vitest";

import { PLACES } from "@/lib/scheduling/__tests__/fixtures";

import { TravelApiError } from "../matrix";
import {
  buildOrsMatrixBody,
  OpenRouteServiceProvider,
  ORS_BASE_URL,
  parseOrsMatrix,
} from "../openRouteService";
import { fakeFetch, json, orsResponse } from "./fakeFetch";

const KEY = "cle-ors-secrete";

describe("OpenRouteServiceProvider", () => {
  it("envoie une matrice [lng, lat] au bon profil, avec la clé dans l'en-tête", async () => {
    const fetch = fakeFetch((c) => json(orsResponse(c.body, (i, j) => 100 * (i + 1) + j)));
    const ors = new OpenRouteServiceProvider({ apiKey: KEY, fetch });
    const m = await ors.matrix([PLACES.cegepEM, PLACES.aliHome], [PLACES.udem], "bike");

    expect(m).toEqual([[100], [200]]);
    expect(fetch.calls).toHaveLength(1);
    const [call] = fetch.calls;
    expect(call.url).toBe(`${ORS_BASE_URL}/v2/matrix/cycling-regular`);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(call.body).toEqual({
      locations: [
        [-73.495, 45.5364],
        [-73.5107, 45.5369],
        [-73.6132, 45.5048],
      ],
      sources: [0, 1],
      destinations: [2],
      metrics: ["duration"],
    });
  });

  it("profils : marche et auto ; pas de transport en commun", async () => {
    const fetch = fakeFetch((c) => json(orsResponse(c.body, () => 60)));
    const ors = new OpenRouteServiceProvider({ apiKey: KEY, fetch });
    await ors.matrix([PLACES.cegepEM], [PLACES.udem], "walk");
    await ors.matrix([PLACES.cegepEM], [PLACES.udem], "car");
    expect(fetch.calls.map((c) => c.url.split("/").pop())).toEqual(["foot-walking", "driving-car"]);
    expect(ors.supports("transit")).toBe(false);
    await expect(ors.matrix([PLACES.cegepEM], [PLACES.udem], "transit")).rejects.toThrow(
      TravelApiError,
    );
  });

  it("minutes : une matrice 1 × 1 arrondie vers le haut", async () => {
    const fetch = fakeFetch((c) => json(orsResponse(c.body, () => 1004.6)));
    const ors = new OpenRouteServiceProvider({ apiKey: KEY, fetch });
    expect(await ors.minutes(PLACES.cegepEM, PLACES.udem, "car")).toBe(17);
  });

  it("trajet introuvable (null) gardé null ; valeurs aberrantes rejetées", () => {
    expect(parseOrsMatrix({ durations: [[null, 12.5, -3, Number.MAX_VALUE]] }, 1, 4)).toEqual([
      [null, 12.5, null, null],
    ]);
  });

  it("forme inattendue : erreur", () => {
    expect(() => parseOrsMatrix({ durations: [[1]] }, 2, 1)).toThrow(TravelApiError);
    expect(() => parseOrsMatrix({ durations: [[1, 2]] }, 1, 1)).toThrow(TravelApiError);
    expect(() => parseOrsMatrix({ distances: [[1]] }, 1, 1)).toThrow(TravelApiError);
    expect(() => parseOrsMatrix(null, 1, 1)).toThrow(TravelApiError);
  });

  it("erreurs réelles d'ORS (quota, clé refusée) : TravelApiError lisible, sans la clé", async () => {
    const quota = fakeFetch(() => json({ error: "Rate limit exceeded" }, 429));
    const e1 = await new OpenRouteServiceProvider({ apiKey: KEY, fetch: quota })
      .matrix([PLACES.cegepEM], [PLACES.udem], "car")
      .catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(TravelApiError);
    expect((e1 as TravelApiError).status).toBe(429);
    expect(String(e1)).toContain("Rate limit exceeded");

    const bad = fakeFetch(() =>
      json(
        {
          error: { code: 6099, message: "Unknown internal error." },
          info: { engine: { version: "9.0.0" }, timestamp: 1762185600000 },
        },
        500,
      ),
    );
    const e2 = await new OpenRouteServiceProvider({ apiKey: KEY, fetch: bad })
      .matrix([PLACES.cegepEM], [PLACES.udem], "car")
      .catch((e: unknown) => e);
    expect(String(e2)).toContain("HTTP 500 Unknown internal error.");
    expect(String(e2)).not.toContain(KEY);

    const html = fakeFetch(() => new Response("<html>502</html>", { status: 502 }));
    await expect(
      new OpenRouteServiceProvider({ apiKey: KEY, fetch: html }).matrix(
        [PLACES.cegepEM],
        [PLACES.udem],
        "car",
      ),
    ).rejects.toThrow("HTTP 502");
  });

  it("refuse une matrice trop grande pour un appel, et une clé vide", async () => {
    const fetch = fakeFetch(() => json({}));
    const ors = new OpenRouteServiceProvider({ apiKey: KEY, fetch });
    const many = Array.from({ length: 60 }, () => PLACES.cegepEM);
    await expect(ors.matrix(many, many, "car")).rejects.toThrow("trop d'éléments");
    expect(fetch.calls).toHaveLength(0);
    expect(() => new OpenRouteServiceProvider({ apiKey: "", fetch })).toThrow();
  });

  it("buildOrsMatrixBody : bloc carré envoyé une seule fois", () => {
    const list = [PLACES.udem, PLACES.cegepEM];
    expect(buildOrsMatrixBody(list, list)).toMatchObject({
      locations: [
        [-73.6132, 45.5048],
        [-73.495, 45.5364],
      ],
      sources: [0, 1],
      destinations: [0, 1],
    });
  });

  it("buildOrsMatrixBody : sources puis destinations", () => {
    expect(
      buildOrsMatrixBody([PLACES.udem], [PLACES.cegepEM, PLACES.samHome]).destinations,
    ).toEqual([1, 2]);
  });
});
