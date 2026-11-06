import { describe, expect, it } from "vitest";

import { PLACES } from "@/lib/scheduling/__tests__/fixtures";

import { createTransitRouter } from "../env";
import { FallbackTravelProvider } from "../fallback";
import {
  GOOGLE_ROUTES_FIELD_MASK,
  GOOGLE_ROUTES_URL,
  GoogleRoutesClient,
  parseGoogleRoute,
} from "../googleRoutes";
import { GoogleTransitProvider } from "../googleTransit";
import { TravelApiError } from "../matrix";
import { CachedTransitRouter, transitCacheKey } from "../transitRouter";
import { fakeFetch, json } from "./fakeFetch";

const KEY = "cle-google-secrete";
const silent = () => {};

/** Forme d'une réponse computeRoutes en TRANSIT : marche, bus, métro, marche. */
const ROUTE = {
  routes: [
    {
      duration: "1500s",
      legs: [
        {
          steps: [
            { travelMode: "WALK", staticDuration: "240s" },
            {
              travelMode: "TRANSIT",
              staticDuration: "600s",
              transitDetails: {
                stopDetails: {
                  departureStop: { name: "Terminus Longueuil" },
                  departureTime: "2025-09-16T19:46:00Z",
                  arrivalTime: "2025-09-16T19:56:00Z",
                },
                headsign: "Station Berri-UQAM",
                transitLine: {
                  nameShort: "51",
                  name: "Édouard-Montpetit",
                  vehicle: { type: "BUS" },
                },
              },
            },
            { travelMode: "WALK", staticDuration: "60s" },
            {
              travelMode: "TRANSIT",
              staticDuration: "420s",
              transitDetails: {
                stopDetails: {
                  departureStop: { name: "Berri-UQAM" },
                  departureTime: "2025-09-16T19:58:00Z",
                  arrivalTime: "2025-09-16T20:05:00Z",
                },
                transitLine: { name: "Ligne verte", vehicle: { type: "SUBWAY" } },
              },
            },
            { travelMode: "WALK", staticDuration: "180s" },
          ],
        },
      ],
    },
  ],
};

const arriveBy = { arrivalTime: new Date("2025-09-16T20:25:00Z") };

describe("parseGoogleRoute", () => {
  it("départ = premier véhicule − marche avant ; arrivée = dernier véhicule + marche après", () => {
    const r = parseGoogleRoute(ROUTE, arriveBy);
    expect(r?.departAt.toISOString()).toBe("2025-09-16T19:42:00.000Z");
    expect(r?.arriveAt.toISOString()).toBe("2025-09-16T20:08:00.000Z");
    expect(r?.legs).toEqual([
      {
        vehicle: "Bus",
        line: "51",
        headsign: "Station Berri-UQAM",
        stop: "Terminus Longueuil",
        departAt: new Date("2025-09-16T19:46:00Z"),
      },
      {
        vehicle: "Métro",
        line: "Ligne verte",
        headsign: "",
        stop: "Berri-UQAM",
        departAt: new Date("2025-09-16T19:58:00Z"),
      },
    ]);
  });

  it("trajet tout à pied : durée totale comptée depuis l'heure demandée", () => {
    const walk = { routes: [{ duration: "900s", legs: [{ steps: [{ travelMode: "WALK" }] }] }] };
    const a = parseGoogleRoute(walk, arriveBy);
    expect(a?.departAt.toISOString()).toBe("2025-09-16T20:10:00.000Z");
    expect(a?.legs).toEqual([]);
    const d = parseGoogleRoute(walk, { departureTime: new Date("2025-09-16T20:00:00Z") });
    expect(d?.arriveAt.toISOString()).toBe("2025-09-16T20:15:00.000Z");
  });

  it("aucune route (réponse vide) : null ; réponse inattendue : erreur", () => {
    expect(parseGoogleRoute({}, arriveBy)).toBeNull();
    expect(parseGoogleRoute({ routes: [] }, arriveBy)).toBeNull();
    expect(() => parseGoogleRoute([], arriveBy)).toThrow(TravelApiError);
    expect(() => parseGoogleRoute({ routes: "x" }, arriveBy)).toThrow(TravelApiError);
  });

  it("textes de Google bornés et sans caractères de contrôle", () => {
    const evil = structuredClone(ROUTE);
    const step = evil.routes[0].legs[0].steps[1] as { transitDetails: { headsign: string } };
    step.transitDetails.headsign = `A\u0000B${"x".repeat(500)}`;
    const r = parseGoogleRoute(evil, arriveBy);
    expect(r?.legs[0].headsign.startsWith("A B")).toBe(true);
    expect(r?.legs[0].headsign.length).toBeLessThanOrEqual(60);
  });
});

describe("GoogleRoutesClient", () => {
  it("demande un trajet TRANSIT avec l'heure d'arrivée ; clé et masque dans les en-têtes", async () => {
    const fetch = fakeFetch(() => json(ROUTE));
    const client = new GoogleRoutesClient({ apiKey: KEY, fetch });
    const r = await client.transit(PLACES.cegepEM, PLACES.downtown, arriveBy);
    expect(r?.legs).toHaveLength(2);
    const [call] = fetch.calls;
    expect(call.url).toBe(GOOGLE_ROUTES_URL);
    expect(call.url).not.toContain(KEY);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(headers["X-Goog-FieldMask"]).toBe(GOOGLE_ROUTES_FIELD_MASK);
    expect(call.body).toMatchObject({
      origin: { location: { latLng: { latitude: 45.5364, longitude: -73.495 } } },
      destination: { location: { latLng: { latitude: 45.5085, longitude: -73.5665 } } },
      travelMode: "TRANSIT",
      arrivalTime: "2025-09-16T20:25:00.000Z",
    });
    expect(call.body).not.toHaveProperty("departureTime");
  });

  it("heure de départ quand on ne peut pas être à l'heure", async () => {
    const fetch = fakeFetch(() => json(ROUTE));
    const client = new GoogleRoutesClient({ apiKey: KEY, fetch });
    await client.transit(PLACES.cegepEM, PLACES.downtown, {
      departureTime: new Date("2025-09-16T19:45:00Z"),
    });
    expect(fetch.calls[0].body).toMatchObject({ departureTime: "2025-09-16T19:45:00.000Z" });
    expect(fetch.calls[0].body).not.toHaveProperty("arrivalTime");
  });

  it("erreur HTTP : TravelApiError sans la clé", async () => {
    const fetch = fakeFetch(() =>
      json({ error: { code: 403, message: "API key not valid" } }, 403),
    );
    const client = new GoogleRoutesClient({ apiKey: KEY, fetch });
    const err = await client
      .transit(PLACES.cegepEM, PLACES.downtown, arriveBy)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TravelApiError);
    expect(String(err)).not.toContain(KEY);
  });
});

describe("CachedTransitRouter", () => {
  const route = { departAt: new Date(0), arriveAt: new Date(60_000), legs: [] };

  it("cache par personne : une 2e demande identique ne rappelle pas l'API", async () => {
    let calls = 0;
    const router = new CachedTransitRouter({
      client: { transit: async () => (calls++, route) },
      reserve: () => true,
      onError: silent,
    });
    await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "ali");
    await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "ali");
    expect(calls).toBe(1);
    // Autre personne : jamais le résultat d'une autre (sa clé de cache est différente).
    await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "sam");
    expect(calls).toBe(2);
    expect(transitCacheKey("ali", PLACES.cegepEM, PLACES.downtown, arriveBy)).toMatch(/^ali\|/);
  });

  it("limite atteinte : pas d'appel, null (estimation)", async () => {
    let calls = 0;
    const router = new CachedTransitRouter({
      client: { transit: async () => (calls++, route) },
      reserve: () => false,
      onError: silent,
    });
    expect(await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "ali")).toBeNull();
    expect(calls).toBe(0);
  });

  it("erreur : null, puis l'API est mise de côté un moment", async () => {
    let t = 0;
    let calls = 0;
    const router = new CachedTransitRouter({
      client: {
        transit: async () => {
          calls++;
          throw new Error("panne");
        },
      },
      reserve: () => true,
      onError: silent,
      now: () => t,
      cooldownMs: 60_000,
    });
    expect(await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "ali")).toBeNull();
    expect(await router.route(PLACES.cegepEM, PLACES.udem, arriveBy, "ali")).toBeNull();
    expect(calls).toBe(1);
    t = 61_000;
    await router.route(PLACES.cegepEM, PLACES.udem, arriveBy, "ali");
    expect(calls).toBe(2);
  });

  it("délai dépassé : null", async () => {
    const router = new CachedTransitRouter({
      client: { transit: () => new Promise(() => {}) },
      reserve: () => true,
      onError: silent,
      timeoutMs: 10,
    });
    expect(await router.route(PLACES.cegepEM, PLACES.downtown, arriveBy, "ali")).toBeNull();
  });
});

describe("createTransitRouter et limite par personne", () => {
  it("sans clé Google : pas de trajets réels", () => {
    const travel = new FallbackTravelProvider({ sources: [] });
    expect(
      createTransitRouter(
        {},
        fakeFetch(() => json(ROUTE)),
        travel,
      ),
    ).toBeNull();
  });

  it("les appels computeRoutes comptent dans la limite par personne des trajets", async () => {
    const fetch = fakeFetch(() => json(ROUTE));
    const travel = new FallbackTravelProvider({
      sources: [new GoogleTransitProvider({ apiKey: KEY, fetch })],
      callsPerUserPerDay: 2,
      onError: silent,
    });
    const router = createTransitRouter({ GOOGLE_MAPS_API_KEY: KEY }, fetch, travel);
    if (!router) throw new Error("attendu : un routeur");
    for (let i = 0; i < 5; i++) {
      await router.route(
        PLACES.cegepEM,
        { ...PLACES.downtown, lat: 45.5 + i / 100 },
        arriveBy,
        "ali",
      );
    }
    expect(fetch.calls).toHaveLength(2);
    expect(travel.tryReserveCall("google", "ali")).toBe(false);
    expect(travel.tryReserveCall("google", "sam")).toBe(true);
    expect(travel.tryReserveCall("inconnue", "sam")).toBe(false);
  });
});
