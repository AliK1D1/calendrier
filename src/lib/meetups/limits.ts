import "server-only";

import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";

/** Recherches par minute et par personne : le calcul occupe le serveur (revue de sécurité). */
export const RECHERCHES_PAR_MINUTE = 20;

/**
 * Limite partagée par « Quand on peut se voir » et « Je suis libre maintenant » (même
 * processus, mêmes compteurs par personne).
 */
export const rechercheLimiter = createKeyedLimiter({
  limit: RECHERCHES_PAR_MINUTE,
  windowMs: 60_000,
});

/**
 * « Je suis libre maintenant » essaie chaque membre de chaque groupe (jusqu'à 40 calculs à
 * deux) : en plus de la limite partagée, au plus 6 par minute et par personne.
 */
export const LIBRES_MAINTENANT_PAR_MINUTE = 6;
export const freeNowLimiter = createKeyedLimiter({
  limit: LIBRES_MAINTENANT_PAR_MINUTE,
  windowMs: 60_000,
});
