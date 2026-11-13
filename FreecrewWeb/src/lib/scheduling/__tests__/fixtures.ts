/**
 * Données de test : 4 personnes fictives de la région de Montréal avec une semaine d'horaire
 * plausible (semaine du lundi 15 au dimanche 21 septembre 2025, heure avancée de l'Est).
 *
 * - ali et Sam : étudiants au Cégep Édouard-Montpetit (Longueuil, Rive-Sud).
 * - Maya : étudiante à l'Université de Montréal.
 * - Léo : travaille au Carrefour Laval.
 *
 * Coordonnées réelles approximatives.
 */
import type { BusyBlock, Person, Place, PlaceId } from "../types";
import { zonedTime } from "../time";

// ---------------------------------------------------------------------------
// Lieux
// ---------------------------------------------------------------------------

export const PLACES = {
  cegepEM: {
    id: "cegep-em",
    name: "Cégep Édouard-Montpetit",
    lat: 45.5364,
    lng: -73.495,
  },
  aliHome: {
    id: "ali-maison",
    name: "Maison d'ali (Vieux-Longueuil)",
    lat: 45.5369,
    lng: -73.5107,
  },
  samHome: {
    id: "sam-maison",
    name: "Maison de Sam (Saint-Lambert)",
    lat: 45.5007,
    lng: -73.5076,
  },
  udem: {
    id: "udem",
    name: "Université de Montréal",
    lat: 45.5048,
    lng: -73.6132,
  },
  mayaHome: {
    id: "maya-maison",
    name: "Maison de Maya (Plateau-Mont-Royal)",
    lat: 45.5226,
    lng: -73.5822,
  },
  carrefourLaval: {
    id: "carrefour-laval",
    name: "Carrefour Laval",
    lat: 45.5712,
    lng: -73.7524,
  },
  leoHome: {
    id: "leo-maison",
    name: "Maison de Léo (Chomedey, Laval)",
    lat: 45.5412,
    lng: -73.7458,
  },
  /** Centre-ville de Montréal (Place des Arts) : lieu de référence pour les trajets. */
  downtown: {
    id: "centre-ville",
    name: "Centre-ville de Montréal (Place des Arts)",
    lat: 45.5085,
    lng: -73.5665,
  },
  /** Lieux favoris du groupe. */
  cafeLongueuil: {
    id: "cafe-longueuil",
    name: "Café rue Saint-Charles (Longueuil)",
    lat: 45.5379,
    lng: -73.5094,
  },
  parcJeanDrapeau: {
    id: "parc-jean-drapeau",
    name: "Parc Jean-Drapeau",
    lat: 45.5089,
    lng: -73.5339,
  },
} as const satisfies Record<string, Place>;

/** Tous les lieux des fixtures, par identifiant. */
export const PLACES_BY_ID: Record<PlaceId, Place> = Object.fromEntries(
  Object.values(PLACES).map((p) => [p.id, p]),
);

/** Lieux favoris du groupe. */
export const GROUP_FAVORITES: Place[] = [PLACES.cafeLongueuil, PLACES.parcJeanDrapeau];

// ---------------------------------------------------------------------------
// Semaine de référence
// ---------------------------------------------------------------------------

export const WEEK = {
  lun: "2025-09-15",
  mar: "2025-09-16",
  mer: "2025-09-17",
  jeu: "2025-09-18",
  ven: "2025-09-19",
  sam: "2025-09-20",
  dim: "2025-09-21",
} as const;

export type WeekDay = keyof typeof WEEK;

/** Instant local (America/Toronto) d'un jour de la semaine de référence. */
export function at(day: WeekDay, time: string): Date {
  return zonedTime(WEEK[day], time);
}

/** Raccourci pour créer un bloc occupé de la semaine de référence. */
export function block(
  id: string,
  day: WeekDay,
  start: string,
  end: string,
  placeId: PlaceId,
  title: string,
): BusyBlock {
  return { id, start: at(day, start), end: at(day, end), placeId, title };
}

// ---------------------------------------------------------------------------
// Personnes
// ---------------------------------------------------------------------------

const EM = PLACES.cegepEM.id;
const UDEM = PLACES.udem.id;
const LAVAL = PLACES.carrefourLaval.id;

/**
 * ali : Sciences de la nature au cégep. Pause de 1 h le lundi de 10 h à 11 h (le cas
 * « ali » du plan) et une pause commune de 30 min avec Sam le mardi de 12 h à 12 h 30.
 */
export const ali: Person = {
  id: "ali",
  name: "ali",
  homePlaceId: PLACES.aliHome.id,
  travelMode: "transit",
  places: [PLACES.aliHome, PLACES.cegepEM],
  busyBlocks: [
    block("ali-lun-1", "lun", "08:00", "10:00", EM, "Chimie générale"),
    block("ali-lun-2", "lun", "11:00", "13:00", EM, "Calcul différentiel"),
    block("ali-lun-3", "lun", "14:00", "16:00", EM, "Philosophie"),
    block("ali-mar-1", "mar", "09:00", "12:00", EM, "Biologie (labo)"),
    block("ali-mar-2", "mar", "12:30", "14:30", EM, "Français"),
    block("ali-mer-1", "mer", "08:00", "10:00", EM, "Physique mécanique"),
    block("ali-mer-2", "mer", "13:00", "15:00", EM, "Anglais"),
    block("ali-jeu-1", "jeu", "10:00", "12:00", EM, "Chimie générale"),
    block("ali-jeu-2", "jeu", "13:00", "16:00", EM, "Physique (labo)"),
    block("ali-ven-1", "ven", "08:00", "10:00", EM, "Calcul différentiel"),
    block("ali-ven-2", "ven", "10:00", "12:00", EM, "Éducation physique"),
  ],
};

/** Sam : même cégep qu'ali, se déplace à vélo. */
export const sam: Person = {
  id: "sam",
  name: "Sam",
  homePlaceId: PLACES.samHome.id,
  travelMode: "bike",
  places: [PLACES.samHome, PLACES.cegepEM],
  busyBlocks: [
    block("sam-lun-1", "lun", "08:00", "11:00", EM, "Techniques de l'informatique"),
    block("sam-lun-2", "lun", "13:00", "15:00", EM, "Mathématiques discrètes"),
    block("sam-mar-1", "mar", "10:00", "12:00", EM, "Programmation web"),
    block("sam-mar-2", "mar", "12:30", "15:00", EM, "Bases de données"),
    block("sam-mer-1", "mer", "10:00", "12:00", EM, "Philosophie"),
    block("sam-mer-2", "mer", "14:00", "17:00", EM, "Réseaux"),
    block("sam-jeu-1", "jeu", "08:00", "11:00", EM, "Programmation web (labo)"),
    block("sam-ven-1", "ven", "09:00", "12:00", EM, "Systèmes d'exploitation"),
    block("sam-ven-2", "ven", "13:00", "15:00", EM, "Français"),
  ],
};

/** Maya : étudiante à l'Université de Montréal, en transport en commun. */
export const maya: Person = {
  id: "maya",
  name: "Maya",
  homePlaceId: PLACES.mayaHome.id,
  travelMode: "transit",
  places: [PLACES.mayaHome, PLACES.udem],
  busyBlocks: [
    block("maya-lun-1", "lun", "08:30", "11:30", UDEM, "Psychologie cognitive"),
    block("maya-lun-2", "lun", "13:00", "16:00", UDEM, "Statistiques"),
    block("maya-mar-1", "mar", "13:00", "16:00", UDEM, "Neurosciences"),
    block("maya-mer-1", "mer", "08:30", "11:30", UDEM, "Méthodes de recherche"),
    block("maya-jeu-1", "jeu", "09:00", "12:00", UDEM, "Psychologie sociale"),
    block("maya-jeu-2", "jeu", "16:00", "19:00", UDEM, "Séminaire"),
  ],
};

/** Léo : vendeur au Carrefour Laval, en auto. */
export const leo: Person = {
  id: "leo",
  name: "Léo",
  homePlaceId: PLACES.leoHome.id,
  travelMode: "car",
  places: [PLACES.leoHome, PLACES.carrefourLaval],
  busyBlocks: [
    block("leo-lun-1", "lun", "12:00", "20:00", LAVAL, "Travail"),
    block("leo-mer-1", "mer", "12:00", "20:00", LAVAL, "Travail"),
    block("leo-ven-1", "ven", "09:00", "17:00", LAVAL, "Travail"),
    block("leo-sam-1", "sam", "10:00", "18:00", LAVAL, "Travail"),
    block("leo-dim-1", "dim", "11:00", "17:00", LAVAL, "Travail"),
  ],
};

/** Les 4 personnes des fixtures. */
export const PEOPLE: Person[] = [ali, sam, maya, leo];
