/**
 * Vocabulaire du cœur de l'app (logique pure, sans BD ni React).
 *
 * Toutes les dates sont des instants absolus (`Date`). L'interprétation en heure locale
 * (jours, heures de la journée) se fait toujours dans le fuseau `America/Toronto`.
 */

/** Identifiant d'un lieu. */
export type PlaceId = string;

/** Identifiant d'une personne. */
export type PersonId = string;

/** Un lieu connu de l'app (cégep, maison, travail, café favori…). */
export interface Place {
  /** Identifiant unique ; deux lieux de même id sont le même endroit (trajet de 0 min). */
  id: PlaceId;
  /** Nom affiché (ex. « Cégep Édouard-Montpetit »). */
  name: string;
  /** Latitude en degrés décimaux (WGS84). */
  lat: number;
  /** Longitude en degrés décimaux (WGS84). */
  lng: number;
}

/** Mode de transport d'une personne : marche, vélo, transport en commun, auto. */
export type TravelMode = "walk" | "bike" | "transit" | "car";

/** Un moment où la personne est occupée à un lieu donné (cours, travail…). */
export interface BusyBlock {
  /** Identifiant unique du bloc. */
  id: string;
  /** Début du bloc (instant absolu). */
  start: Date;
  /** Fin du bloc (instant absolu, exclusif). */
  end: Date;
  /** Lieu où la personne se trouve pendant le bloc. */
  placeId: PlaceId;
  /** Titre du bloc (ex. « Chimie générale »). */
  title: string;
}

/** Une personne, avec son horaire et ses lieux. */
export interface Person {
  /** Identifiant unique. */
  id: PersonId;
  /** Nom affiché. */
  name: string;
  /** Lieu « maison » : point de départ en début de journée et de retour en fin de journée. */
  homePlaceId: PlaceId;
  /** Mode de transport utilisé pour tous ses trajets. */
  travelMode: TravelMode;
  /** Ses blocs occupés (dans n'importe quel ordre, chevauchements permis). */
  busyBlocks: BusyBlock[];
  /** Ses lieux enregistrés (doit contenir la maison et les lieux de ses blocs). */
  places: Place[];
}

/** Un trou libre entre deux blocs occupés, avec le lieu où la personne est avant et après. */
export interface FreeWindow {
  /** Début de la fenêtre (fin du bloc précédent ou début de la journée considérée). */
  start: Date;
  /** Fin de la fenêtre (début du bloc suivant ou fin de la journée considérée). */
  end: Date;
  /** Lieu où la personne se trouve juste avant la fenêtre (maison s'il n'y a pas de bloc). */
  placeBeforeId: PlaceId;
  /** Lieu où la personne doit être juste après la fenêtre (maison s'il n'y a pas de bloc). */
  placeAfterId: PlaceId;
}

/** Intervalle pendant lequel une personne peut réellement être présente à un lieu donné. */
export interface Availability {
  /** La personne concernée. */
  personId: PersonId;
  /** Arrivée au plus tôt au lieu (trajet et marge inclus). */
  start: Date;
  /** Départ au plus tard du lieu (trajet et marge inclus). */
  end: Date;
}

/** Plage de jours locaux (fuseau America/Toronto), bornes incluses, au format `yyyy-MM-dd`. */
export interface DateRange {
  /** Premier jour inclus (ex. « 2025-09-15 »). */
  from: string;
  /** Dernier jour inclus (ex. « 2025-09-21 »). */
  to: string;
}

/** Heures de la journée considérées, en heure locale `HH:mm` (le reste compte comme occupé). */
export interface DayHours {
  /** Heure de début (ex. « 08:00 »). */
  start: string;
  /** Heure de fin (ex. « 22:00 » ; « 24:00 » = minuit suivant). */
  end: string;
}

/** Une demande de recherche de rencontre pour un groupe. */
export interface MeetupRequest {
  /** Les personnes qui doivent toutes être présentes. */
  personIds: PersonId[];
  /** Jour(s) sur lesquels chercher (un seul jour : from === to). */
  dates: DateRange;
  /** Durée minimale de la rencontre, en minutes. */
  minDurationMinutes: number;
  /** Marge ajoutée à chaque trajet (aller et retour), en minutes. */
  bufferMinutes: number;
  /** Lieux à considérer ; à défaut, tous les lieux des participants et les favoris. */
  candidatePlaceIds?: PlaceId[];
  /** Lieux favoris du groupe (café, parc…), ajoutés aux candidats par défaut. */
  favoritePlaces?: Place[];
  /** Heures de la journée où l'on accepte de se voir (défaut : 08:00 à 22:00). */
  dayHours?: DayHours;
  /**
   * Ne rien proposer avant cet instant (en général « maintenant ») : un créneau commencé est
   * raccourci (on peut arriver plus tard), puis gardé seulement s'il dure encore au moins
   * `minDurationMinutes`.
   */
  notBefore?: Date;
}

/** Temps de trajet d'une personne pour une proposition, en minutes (marge non comprise). */
export interface TravelLeg {
  /** Trajet du lieu d'avant vers le lieu de rencontre. */
  to: number;
  /** Trajet du lieu de rencontre vers le lieu d'après. */
  from: number;
}

/** Type de proposition : rencontre en personne, ou appel/visio (aucun trajet). */
export type MeetupKind = "in-person" | "call";

/** Une proposition de rencontre : un lieu et un créneau où tout le monde peut être présent. */
export interface MeetupProposal {
  /** En personne, ou appel/visio quand aucune rencontre en personne n'est possible ce jour-là. */
  kind: MeetupKind;
  /** Lieu de la rencontre (`null` pour un appel). */
  placeId: PlaceId | null;
  /** Début du créneau commun. */
  start: Date;
  /** Fin du créneau commun. */
  end: Date;
  /** Trajets de chaque participant, par identifiant de personne (0 pour un appel). */
  travelByPerson: Record<PersonId, TravelLeg>;
  /** Score de classement (plus haut = meilleur). */
  score: number;
}
