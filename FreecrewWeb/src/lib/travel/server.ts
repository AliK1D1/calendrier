import "server-only";

import type { TravelTimeProvider } from "@/lib/scheduling/travel";

import { createTransitRouter, createTravelProvider } from "./env";
import type { TransitRouter } from "./transitRouter";

/**
 * Fournisseur de trajets partagé par toutes les requêtes du processus (un seul cache, une
 * seule limite d'appels). Les clés restent sur le serveur (`server-only`).
 */
let instance: TravelTimeProvider | null = null;
let transit: TransitRouter | null | undefined;

const env = () => ({
  ORS_API_KEY: process.env.ORS_API_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
});
const serverFetch = (input: string, init: RequestInit) => fetch(input, init);

export function getTravelProvider(): TravelTimeProvider {
  instance ??= createTravelProvider(env(), serverFetch);
  return instance;
}

/**
 * Story 6 : trajets réels en transport en commun (Google Compute Routes), ou `null` sans clé
 * Google. Ses appels comptent dans les mêmes limites que ceux de `getTravelProvider()`.
 */
export function getTransitRouter(): TransitRouter | null {
  if (transit === undefined) transit = createTransitRouter(env(), serverFetch, getTravelProvider());
  return transit;
}
