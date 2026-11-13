/**
 * Validation des données de lieux et de profil reçues du navigateur (fonctions pures, testées).
 * Les actions serveur ne font jamais confiance à ce que le client envoie : tout passe ici avant
 * d'aller dans Supabase (où la RLS et les contraintes CHECK font un second contrôle).
 */
import type { TravelMode } from "@/lib/scheduling/types";

/** Longueur maximale d'un nom de lieu (même limite que la contrainte `places_name_length`). */
export const PLACE_NAME_MAX = 100;

/** Longueur maximale d'un nom affiché. */
export const DISPLAY_NAME_MAX = 60;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PlaceInput {
  name: string;
  lat: number;
  lng: number;
}

export const TRAVEL_MODES: readonly TravelMode[] = ["walk", "bike", "transit", "car"];

/** Libellés français des modes de transport, dans l'ordre d'affichage. */
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  transit: "Transport en commun",
  walk: "Marche",
  bike: "Vélo",
  car: "Auto",
};

// Caractères de contrôle (dont retours de ligne) : refusés dans les noms.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Nettoie un texte : forme NFC, espaces multiples réduits, bouts coupés. */
export function cleanText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

function validateName(raw: unknown, max: number, label: string): Result<string> {
  if (typeof raw !== "string") return { ok: false, error: `${label} manquant.` };
  if (CONTROL_CHARS.test(raw.replace(/[\t\n\r]/g, " "))) {
    return { ok: false, error: `${label} contient des caractères invalides.` };
  }
  const name = cleanText(raw);
  if (name.length === 0) return { ok: false, error: `${label} ne peut pas être vide.` };
  if (name.length > max) {
    return { ok: false, error: `${label} est trop long (${max} caractères au maximum).` };
  }
  return { ok: true, value: name };
}

/** Nom d'un lieu : 1 à 100 caractères après nettoyage. */
export function validatePlaceName(raw: unknown): Result<string> {
  return validateName(raw, PLACE_NAME_MAX, "Le nom du lieu");
}

/** Nom affiché d'une personne : 1 à 60 caractères après nettoyage. */
export function validateDisplayName(raw: unknown): Result<string> {
  return validateName(raw, DISPLAY_NAME_MAX, "Le nom");
}

/** Lit un nombre (number ou chaîne, virgule décimale acceptée). `null` si invalide. */
export function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Arrondit une coordonnée à 6 décimales (environ 10 cm, largement assez). */
export function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Coordonnées WGS84 valides (latitude −90..90, longitude −180..180), arrondies. */
export function validateCoordinates(
  rawLat: unknown,
  rawLng: unknown,
): Result<{ lat: number; lng: number }> {
  const lat = toFiniteNumber(rawLat);
  const lng = toFiniteNumber(rawLng);
  if (lat === null || lng === null) return { ok: false, error: "Position du lieu invalide." };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: "Position du lieu hors limites." };
  }
  return { ok: true, value: { lat: roundCoord(lat), lng: roundCoord(lng) } };
}

/** Valide un lieu complet (nom + position). */
export function validatePlaceInput(raw: unknown): Result<PlaceInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Lieu invalide." };
  const r = raw as Record<string, unknown>;
  const name = validatePlaceName(r.name);
  if (!name.ok) return name;
  const coords = validateCoordinates(r.lat, r.lng);
  if (!coords.ok) return coords;
  return { ok: true, value: { name: name.value, ...coords.value } };
}

export function isTravelMode(raw: unknown): raw is TravelMode {
  return typeof raw === "string" && (TRAVEL_MODES as readonly string[]).includes(raw);
}

/** Mode de transport parmi `walk`, `bike`, `transit`, `car`. */
export function validateTravelMode(raw: unknown): Result<TravelMode> {
  return isTravelMode(raw)
    ? { ok: true, value: raw }
    : { ok: false, error: "Mode de transport invalide." };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de lieu (uuid). */
export function validatePlaceId(raw: unknown): Result<string> {
  return typeof raw === "string" && UUID.test(raw)
    ? { ok: true, value: raw.toLowerCase() }
    : { ok: false, error: "Lieu introuvable." };
}

export interface OnboardingInput {
  home: PlaceInput;
  school: PlaceInput | null;
  travelMode: TravelMode;
}

/** Onboarding : maison obligatoire, cégep/école facultatif, mode de transport. */
export function validateOnboardingInput(raw: unknown): Result<OnboardingInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Données invalides." };
  const r = raw as Record<string, unknown>;
  if (r.home == null) return { ok: false, error: "Choisis l'adresse de ta maison." };
  const home = validatePlaceInput(r.home);
  if (!home.ok) return { ok: false, error: `Maison : ${home.error}` };
  let school: PlaceInput | null = null;
  if (r.school != null) {
    const s = validatePlaceInput(r.school);
    if (!s.ok) return { ok: false, error: `Cégep ou école : ${s.error}` };
    school = s.value;
  }
  const mode = validateTravelMode(r.travelMode);
  if (!mode.ok) return mode;
  return { ok: true, value: { home: home.value, school, travelMode: mode.value } };
}
