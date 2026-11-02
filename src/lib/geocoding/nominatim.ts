/**
 * Géocodage avec Nominatim (OpenStreetMap) : construction de la requête et lecture de la
 * réponse, en fonctions pures. Politique d'utilisation : https://operations.osmfoundation.org/policies/nominatim/
 * (User-Agent qui identifie l'app, 1 requête/s au maximum, résultats mis en cache, pas
 * d'autocomplétion à chaque touche).
 */
import { roundCoord } from "@/lib/places/validation";

export const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

/** User-Agent envoyé à Nominatim : identifie l'app (exigé par la politique d'utilisation). */
export const NOMINATIM_USER_AGENT = "TempsLibreCommun/0.1 (projet étudiant)";

export const QUERY_MIN = 3;
export const QUERY_MAX = 200;

/** Un résultat de recherche d'adresse, prêt à afficher et à enregistrer. */
export interface GeocodeResult {
  /** Identifiant OSM stable (ex. « way/123 »), ou place_id à défaut. */
  id: string;
  /** Nom court proposé pour le lieu (ex. « Cégep Édouard-Montpetit »). */
  name: string;
  /** Adresse complète (display_name). */
  address: string;
  lat: number;
  lng: number;
  /** Genre de lieu en français (ex. « Arrêt d'autobus »), ou `null` si inconnu. */
  kind: string | null;
}

export type QueryResult = { ok: true; query: string } | { ok: false; error: string };

/** Valide et nettoie le texte recherché (3 à 200 caractères, sans caractères de contrôle). */
export function normalizeQuery(raw: unknown): QueryResult {
  if (typeof raw !== "string") return { ok: false, error: "Tape une adresse ou un nom de lieu." };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: "La recherche contient des caractères invalides." };
  }
  const query = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (query.length < QUERY_MIN) {
    return { ok: false, error: `Tape au moins ${QUERY_MIN} caractères.` };
  }
  if (query.length > QUERY_MAX) {
    return { ok: false, error: `Recherche trop longue (${QUERY_MAX} caractères au maximum).` };
  }
  return { ok: true, query };
}

/** Clé de cache : insensible à la casse (les accents comptent). */
export function cacheKey(query: string): string {
  return query.toLocaleLowerCase("fr-CA");
}

export interface SearchUrlOptions {
  baseUrl?: string;
  limit?: number;
  /** Codes pays ISO séparés par des virgules (défaut : « ca »). */
  countryCodes?: string;
  /** Langue des résultats (défaut : « fr »). */
  language?: string;
  /** Courriel de contact facultatif (recommandé par Nominatim pour un usage régulier). */
  email?: string;
}

/** URL de recherche Nominatim (format jsonv2). */
export function buildSearchUrl(query: string, options: SearchUrlOptions = {}): string {
  const url = new URL("/search", options.baseUrl ?? NOMINATIM_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(options.limit ?? 5));
  url.searchParams.set("countrycodes", options.countryCodes ?? "ca");
  url.searchParams.set("accept-language", options.language ?? "fr");
  if (options.email) url.searchParams.set("email", options.email);
  return url.toString();
}

/** Libellés français de quelques genres OSM (`category/type`, ou `category/*`). */
const KIND_LABELS: Record<string, string> = {
  "amenity/college": "Cégep / collège",
  "amenity/university": "Établissement d'enseignement",
  "amenity/school": "École",
  "amenity/library": "Bibliothèque",
  "amenity/cafe": "Café",
  "amenity/restaurant": "Restaurant",
  "amenity/bicycle_rental": "Station de vélos",
  "highway/bus_stop": "Arrêt d'autobus",
  "railway/station": "Gare",
  "railway/subway_entrance": "Entrée de métro",
  "public_transport/station": "Station",
  "public_transport/platform": "Quai",
  "leisure/park": "Parc",
  "building/*": "Bâtiment",
  "place/house": "Adresse",
  "highway/*": "Rue",
  "shop/*": "Commerce",
  "place/*": "Localité",
  "boundary/*": "Territoire",
};

function kindLabel(category: string | null, type: string | null): string | null {
  if (!category) return null;
  return KIND_LABELS[`${category}/${type}`] ?? KIND_LABELS[`${category}/*`] ?? null;
}

/**
 * Vrai pour les petits points de transport (arrêt d'autobus, quai, station de vélos…) qui
 * portent souvent le nom du lieu cherché (« Cégep Édouard-Montpetit ») sans être le lieu.
 */
export function isTransitStop(category: string | null, type: string | null): boolean {
  if (category === "highway") return type === "bus_stop" || type === "platform";
  if (category === "public_transport") return type === "platform" || type === "stop_position";
  if (category === "railway") return type === "platform" || type === "tram_stop";
  if (category === "amenity") return type === "bicycle_rental" || type === "bus_station";
  return false;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

/**
 * Lit la réponse JSON de /search (format jsonv2 : un tableau d'objets avec `lat` et `lon` en
 * chaînes, `name`, `display_name`, `osm_type`, `osm_id`…). Les éléments incomplets ou hors
 * limites sont ignorés ; les doublons (même identifiant) aussi. Les arrêts de transport sont
 * placés après les autres résultats (ordre de Nominatim gardé sinon). Lève une erreur si la
 * réponse n'est pas un tableau.
 */
export function parseSearchResponse(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) throw new Error("Réponse Nominatim inattendue");
  const results: GeocodeResult[] = [];
  const stops: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const item of json) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const lat = Number(asString(r.lat));
    const lng = Number(asString(r.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const address = (asString(r.display_name) ?? "").trim();
    const osmType = asString(r.osm_type);
    const osmId = asString(r.osm_id);
    const placeId = asString(r.place_id);
    const id = osmType && osmId ? `${osmType}/${osmId}` : placeId ? `place/${placeId}` : null;
    if (!id || seen.has(id)) continue;
    const name = (asString(r.name) ?? "").trim() || address.split(",")[0]?.trim() || "";
    if (!name) continue;
    seen.add(id);
    const category = asString(r.category);
    const type = asString(r.type);
    (isTransitStop(category, type) ? stops : results).push({
      id,
      name: name.slice(0, 100),
      address: address || name,
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      kind: kindLabel(category, type),
    });
  }
  return [...results, ...stops];
}
