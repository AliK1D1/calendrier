import type { Person, Place, PlaceId, TravelMode } from "./types";

/**
 * Fournisseur de temps de trajet. Interface remplaçable : estimation maison (ici) ou vraie API
 * (OpenRouteService, Google : `src/lib/travel/`, segment 15).
 */
export interface TravelTimeProvider {
  /** Temps de trajet en minutes (entier, arrondi vers le haut) de `from` vers `to`. */
  minutes(from: Place, to: Place, mode: TravelMode): Promise<number>;
  /**
   * Facultatif : prépare d'avance, en quelques appels groupés (« matrice »), les trajets entre
   * ces lieux. Appelé AVANT le calcul (findMeetups, planificateur), qui n'attend ainsi jamais
   * le réseau. Ne lève jamais d'erreur : ce qui n'a pas pu être préparé sera estimé.
   */
  prefetch?(requests: readonly TravelPrefetchRequest[]): Promise<void>;
}

/** Lieux entre lesquels préparer les trajets, pour un mode de transport. */
export interface TravelPrefetchRequest {
  mode: TravelMode;
  /** Les plus importants d'abord (si l'API est limitée, la fin de la liste est estimée). */
  places: Place[];
}

/**
 * Trajets à préparer pour une recherche de groupe : par mode, les maisons des personnes de ce
 * mode, puis les lieux candidats (`candidateIds`, ou tous les lieux connus), puis leurs autres
 * lieux (où elles sont avant et après une fenêtre libre). Fonction pure, sans doublon.
 */
export function prefetchRequestsFor(
  people: readonly Person[],
  favoritePlaces: readonly Place[] = [],
  candidateIds?: readonly PlaceId[],
): TravelPrefetchRequest[] {
  const all = new Map<PlaceId, Place>();
  for (const person of people) for (const p of person.places) all.set(p.id, p);
  for (const f of favoritePlaces) all.set(f.id, f);
  const candidates = candidateIds
    ? candidateIds.flatMap((id) => all.get(id) ?? [])
    : [...all.values()];

  const modes: TravelMode[] = [];
  for (const person of people)
    if (!modes.includes(person.travelMode)) modes.push(person.travelMode);
  return modes.map((mode) => {
    const ofMode = people.filter((p) => p.travelMode === mode);
    const places = new Map<PlaceId, Place>();
    const add = (p: Place | undefined) => {
      if (p && !places.has(p.id)) places.set(p.id, p);
    };
    for (const person of ofMode) add(all.get(person.homePlaceId));
    for (const c of candidates) add(c);
    for (const person of ofMode) for (const p of person.places) add(p);
    return { mode, places: [...places.values()] };
  });
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
  assertValidCoordinates(from);
  assertValidCoordinates(to);
  if (!Object.hasOwn(SPEED_KMH, mode)) throw new Error(`Mode de transport inconnu : ${mode}`);
  if (isSamePlace(from, to)) return 0;
  const km = haversineKm(from, to) * DETOUR_FACTOR;
  const minutes = (km / SPEED_KMH[mode]) * 60 + FIXED_OVERHEAD_MINUTES[mode];
  return Math.ceil(minutes);
}

/**
 * Refuse des coordonnées non finies ou hors limites. Sans ce contrôle, un lieu mal saisi
 * (NaN, latitude 200…) donnait un trajet NaN, et la personne disparaissait en silence de
 * toutes les propositions au lieu d'avoir une erreur claire.
 */
export function assertValidCoordinates(place: Pick<Place, "id" | "lat" | "lng">): void {
  const { lat, lng } = place;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`Coordonnées invalides pour le lieu ${place.id} : ${lat}, ${lng}`);
  }
}

/** Nombre maximal de paires gardées en cache par défaut. */
export const DEFAULT_TRAVEL_CACHE_SIZE = 10_000;

/**
 * Estimation maison, sans API, avec cache en mémoire par (from, to, mode).
 *
 * Le cache est borné (les paires les moins récemment utilisées sont retirées) : un provider
 * partagé côté serveur ne doit pas grossir sans fin quand des utilisateurs ajoutent des lieux.
 */
export class EstimatedTravelProvider implements TravelTimeProvider {
  private readonly cache = new Map<string, number>();

  constructor(private readonly maxCacheEntries: number = DEFAULT_TRAVEL_CACHE_SIZE) {
    if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
      throw new Error("La taille du cache doit être un entier positif.");
    }
  }

  async minutes(from: Place, to: Place, mode: TravelMode): Promise<number> {
    const key = cacheKey(from, to, mode);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Remis en fin de file : c'est maintenant la paire la plus récemment utilisée.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const value = estimateTravelMinutes(from, to, mode);
    if (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
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

/**
 * Clé de cache : identifiants et coordonnées (un lieu déplacé n'utilise pas l'ancienne valeur).
 * JSON.stringify rend la clé non ambiguë même si un id contient « @ », « , » ou « | ».
 */
function cacheKey(from: Place, to: Place, mode: TravelMode): string {
  return JSON.stringify([from.id, from.lat, from.lng, to.id, to.lat, to.lng, mode]);
}
