import "server-only";

import { createNominatimGeocoder, type Geocoder } from "./geocoder";

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
