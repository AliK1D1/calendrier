/**
 * Limites de l'import .ics, à part du parseur pour que l'interface (navigateur) puisse les
 * lire sans charger ical.js.
 */

/** Taille maximale du fichier, en octets (1 Mo). */
export const ICS_MAX_BYTES = 1_000_000;
/** Nombre maximal d'événements (VEVENT) dans le fichier. */
export const ICS_MAX_EVENTS = 1000;
/** Nombre maximal d'occurrences gardées (sur un an). */
export const ICS_MAX_OCCURRENCES = 5000;
/** Nombre maximal de blocs produits par un import. */
export const ICS_MAX_BLOCKS = 300;
/** Longueur maximale du texte de lieu gardé (même limite qu'un nom de lieu). */
export const ICS_LOCATION_MAX = 100;
/** Fenêtre d'import par défaut, en jours à partir d'aujourd'hui (inclus). */
export const ICS_DEFAULT_HORIZON_DAYS = 365;
