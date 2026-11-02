import type { Place, TravelMode } from "./types";

/**
 * Fournisseur de temps de trajet. Interface remplaçable : estimation maison (ici), puis une
 * vraie API (OpenRouteService, Google…) au segment 15.
 */
export interface TravelTimeProvider {
  /** Temps de trajet en minutes (entier, arrondi vers le haut) de `from` vers `to`. */
  minutes(from: Place, to: Place, mode: TravelMode): Promise<number>;
}

/** Rayon moyen de la Terre, en km. */
export const EARTH_RADIUS_KM = 6371;

/** Facteur de détour : la route réelle est plus longue que la distance à vol d'oiseau. */
export const DETOUR_FACTOR = 1.3;

/** Vitesses moyennes par mode, en km/h. */
export const SPEED_KMH: Readonly<Record<TravelMode, number>> = {
  walk: 4.5,
  bike: 15,
  transit: 18,
  car: 30,
};

/** Temps fixe ajouté par mode, en minutes (attente du bus/métro, stationnement). */
export const FIXED_OVERHEAD_MINUTES: Readonly<Record<TravelMode, number>> = {
  walk: 0,
  bike: 0,
  transit: 10,
  car: 5,
};

/** En deçà de cette distance (km), deux lieux sont considérés comme le même endroit. */
export const SAME_PLACE_THRESHOLD_KM = 0.05;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau (formule de haversine), en km. */
export function haversineKm(a: Pick<Place, "lat" | "lng">, b: Pick<Place, "lat" | "lng">): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Vrai si les deux lieux sont le même endroit (même id ou quasiment les mêmes coordonnées). */
export function isSamePlace(a: Place, b: Place): boolean {
  return a.id === b.id || haversineKm(a, b) < SAME_PLACE_THRESHOLD_KM;
}

/**
 * Estimation pure du temps de trajet, en minutes entières (arrondi vers le haut) :
 * distance haversine × détour ÷ vitesse du mode + temps fixe du mode ; 0 si même lieu.
 */
export function estimateTravelMinutes(from: Place, to: Place, mode: TravelMode): number {
  if (isSamePlace(from, to)) return 0;
  const km = haversineKm(from, to) * DETOUR_FACTOR;
  const minutes = (km / SPEED_KMH[mode]) * 60 + FIXED_OVERHEAD_MINUTES[mode];
  return Math.ceil(minutes);
}

/** Estimation maison, sans API, avec cache en mémoire par (from, to, mode). */
export class EstimatedTravelProvider implements TravelTimeProvider {
  private readonly cache = new Map<string, number>();

  async minutes(from: Place, to: Place, mode: TravelMode): Promise<number> {
    const key = cacheKey(from, to, mode);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const value = estimateTravelMinutes(from, to, mode);
    this.cache.set(key, value);
    return value;
  }

  /** Nombre de paires en cache (utile pour les tests et le diagnostic). */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Vide le cache. */
  clearCache(): void {
    this.cache.clear();
  }
}

/** Clé de cache : identifiants et coordonnées (un lieu déplacé n'utilise pas l'ancienne valeur). */
function cacheKey(from: Place, to: Place, mode: TravelMode): string {
  return `${from.id}@${from.lat},${from.lng}|${to.id}@${to.lat},${to.lng}|${mode}`;
}
