import { describe, expect, it } from "vitest";

import { PLACES } from "@/lib/scheduling/__tests__/fixtures";

import {
  GOOGLE_FIELD_MASK,
  GOOGLE_ROUTE_MATRIX_URL,
  GoogleTransitProvider,
  parseGoogleMatrix,
} from "../googleTransit";
import { TravelApiError } from "../matrix";
import { fakeFetch, json } from "./fakeFetch";

const KEY = "cle-google-secrete";

/** Vraie forme d'une réponse computeRouteMatrix (REST) : index 0 omis, statut vide = OK. */
const REAL_RESPONSE = [
  { destinationIndex: 1, status: {}, duration: "2412s", condition: "ROUTE_EXISTS" },
  { originIndex: 1, status: {}, duration: "1867s", condition: "ROUTE_EXISTS" },
  { status: {}, duration: "0s", condition: "ROUTE_EXISTS" },
  {
    originIndex: 1,
    destinationIndex: 1,
    status: { code: 5, message: "No transit route found." },
    condition: "ROUTE_NOT_FOUND",
  },
];

describe("GoogleTransitProvider", () => {
  it("envoie origines et destinations en TRANSIT, clé et masque de champs dans les en-têtes", async () => {
    const fetch = fakeFetch(() => json(REAL_RESPONSE));
    const google = new GoogleTransitProvider({ apiKey: KEY, fetch });
    const m = await google.matrix(
      [PLACES.cegepEM, PLACES.udem],
      [PLACES.cegepEM, PLACES.downtown],
      "transit",
    );
    expect(m).toEqual([
      [0, 2412],
      [1867, null],
    ]);
    const [call] = fetch.calls;
    expect(call.url).toBe(GOOGLE_ROUTE_MATRIX_URL);
    expect(call.url).not.toContain(KEY);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(headers["X-Goog-FieldMask"]).toBe(GOOGLE_FIELD_MASK);
    expect(call.body).toEqual({
      origins: [
        { waypoint: { location: { latLng: { latitude: 45.5364, longitude: -73.495 } } } },
        { waypoint: { location: { latLng: { latitude: 45.5048, longitude: -73.6132 } } } },
      ],
      destinations: [
        { waypoint: { location: { latLng: { latitude: 45.5364, longitude: -73.495 } } } },
        { waypoint: { location: { latLng: { latitude: 45.5085, longitude: -73.5665 } } } },
      ],
      travelMode: "TRANSIT",
    });
  });

  it("transport en commun seulement", async () => {
    const google = new GoogleTransitProvider({ apiKey: KEY, fetch: fakeFetch(() => json([])) });
    expect(google.supports("transit")).toBe(true);
    expect(google.supports("car")).toBe(false);
    await expect(google.matrix([PLACES.udem], [PLACES.cegepEM], "car")).rejects.toThrow(
      TravelApiError,
    );
  });

  it("minutes : 1 × 1, arrondi vers le haut ; aucune route → erreur", async () => {
    const ok = new GoogleTransitProvider({
      apiKey: KEY,
      fetch: fakeFetch(() => json([{ status: {}, duration: "1801s", condition: "ROUTE_EXISTS" }])),
    });
    expect(await ok.minutes(PLACES.cegepEM, PLACES.udem, "transit")).toBe(31);
    const none = new GoogleTransitProvider({
      apiKey: KEY,
      fetch: fakeFetch(() => json([{ status: {}, condition: "ROUTE_NOT_FOUND" }])),
    });
    await expect(none.minutes(PLACES.cegepEM, PLACES.udem, "transit")).rejects.toThrow(
      "aucun trajet",
    );
  });

  it("erreur réelle de Google (clé refusée) : TravelApiError sans la clé", async () => {
    const fetch = fakeFetch(() =>
      json(
        {
          error: {
            code: 403,
            message: "Routes API has not been used in project 123 before or it is disabled.",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      ),
    );
    const e = await new GoogleTransitProvider({ apiKey: KEY, fetch })
      .matrix([PLACES.cegepEM], [PLACES.udem], "transit")
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TravelApiError);
    expect(String(e)).toContain("HTTP 403 Routes API has not been used");
    expect(String(e)).not.toContain(KEY);
  });

  it("parseGoogleMatrix : ignore les index hors limites et les durées illisibles", () => {
    expect(
      parseGoogleMatrix(
        [
          { originIndex: 7, destinationIndex: 0, duration: "60s" },
          { originIndex: 0, destinationIndex: 0, duration: "60 s" },
          "n'importe quoi",
        ],
        1,
        1,
      ),
    ).toEqual([[null]]);
    expect(() => parseGoogleMatrix({ error: {} }, 1, 1)).toThrow(TravelApiError);
  });

  it("refuse plus de 100 éléments en un appel", async () => {
    const fetch = fakeFetch(() => json([]));
    const google = new GoogleTransitProvider({ apiKey: KEY, fetch });
    const eleven = Array.from({ length: 11 }, () => PLACES.udem);
    await expect(google.matrix(eleven, eleven, "transit")).rejects.toThrow("trop d'éléments");
    expect(fetch.calls).toHaveLength(0);
  });
});
