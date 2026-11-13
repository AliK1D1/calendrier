import "server-only";

import { createNominatimGeocoder, type Geocoder } from "./geocoder";
import { createKeyedLimiter, type KeyedLimiter } from "./rateLimiter";

/**
 * Géocodeur partagé par toutes les requêtes du serveur : un seul cache et une seule file
 * « 1 requête/s » par processus. (Sur un hébergement à plusieurs instances, chaque instance a
 * sa propre file ; à revoir au déploiement si le trafic grossit.)
 */
let instance: Geocoder | null = null;

export function getGeocoder(): Geocoder {
  instance ??= createNominatimGeocoder({
    fetch: (input, init) => fetch(input, init),
    email: process.env.NOMINATIM_EMAIL?.trim() || undefined,
  });
  return instance;
}

/** Recherches d'adresse permises par personne et par minute (une recherche = un clic). */
export const GEOCODE_PER_USER_PER_MINUTE = 20;

let perUser: KeyedLimiter | null = null;

/** Limite par personne, partagée par toutes les requêtes du processus. */
export function getGeocodeUserLimiter(): KeyedLimiter {
  perUser ??= createKeyedLimiter({ limit: GEOCODE_PER_USER_PER_MINUTE, windowMs: 60_000 });
  return perUser;
}
