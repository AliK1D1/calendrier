/**
 * Choix du fournisseur de trajets selon les clés présentes (côté serveur seulement : les
 * variables n'ont pas le préfixe NEXT_PUBLIC_, Next.js ne les envoie jamais au navigateur).
 *
 * - Aucune clé : `EstimatedTravelProvider`, exactement comme avant le segment 15.
 * - `ORS_API_KEY` : marche, vélo et auto par OpenRouteService.
 * - `GOOGLE_MAPS_API_KEY` : transport en commun par Google (Routes API).
 * Dans tous les cas, ce qui manque ou échoue est estimé.
 */
import { EstimatedTravelProvider, type TravelTimeProvider } from "@/lib/scheduling/travel";

import { FallbackTravelProvider } from "./fallback";
import { GoogleTransitProvider } from "./googleTransit";
import type { FetchLike, TravelMatrixSource } from "./matrix";
import { OpenRouteServiceProvider } from "./openRouteService";

export interface TravelEnv {
  ORS_API_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
}

export function createTravelProvider(env: TravelEnv, fetch: FetchLike): TravelTimeProvider {
  const ors = env.ORS_API_KEY?.trim();
  const google = env.GOOGLE_MAPS_API_KEY?.trim();
  const sources: TravelMatrixSource[] = [];
  if (ors) sources.push(new OpenRouteServiceProvider({ apiKey: ors, fetch }));
  if (google) sources.push(new GoogleTransitProvider({ apiKey: google, fetch }));
  if (sources.length === 0) return new EstimatedTravelProvider();
  return new FallbackTravelProvider({ sources });
}
