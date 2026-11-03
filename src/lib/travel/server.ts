import "server-only";

import type { TravelTimeProvider } from "@/lib/scheduling/travel";

import { createTravelProvider } from "./env";

/**
 * Fournisseur de trajets partagé par toutes les requêtes du processus (un seul cache, une
 * seule limite d'appels). Les clés restent sur le serveur (`server-only`).
 */
let instance: TravelTimeProvider | null = null;

export function getTravelProvider(): TravelTimeProvider {
  instance ??= createTravelProvider(
    { ORS_API_KEY: process.env.ORS_API_KEY, GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY },
    (input, init) => fetch(input, init),
  );
  return instance;
}
