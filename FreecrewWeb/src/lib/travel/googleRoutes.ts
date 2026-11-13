/**
 * Story 6 : vrai trajet en transport en commun pour une date précise, avec la ligne à prendre
 * (« Bus 51 à 15 h 42 »). Google Routes API, « Compute Routes »
 * (`POST https://routes.googleapis.com/directions/v2:computeRoutes`), en mode TRANSIT avec
 * `arrivalTime` (arriver avant le plan) ou `departureTime` (partir à la fin de mon bloc).
 *
 * Côté serveur seulement : la clé ne quitte jamais le serveur, et seules les coordonnées de
 * MON lieu d'avant et du lieu du plan sont envoyées.
 *
 * Réponse utile : `routes[0].duration` (« 1380s ») et `routes[0].legs[*].steps[*]` : chaque étape
 * a un `travelMode` (WALK ou TRANSIT) et une `staticDuration` ; une étape TRANSIT a des
 * `transitDetails` (arrêts, heures de départ et d'arrivée RFC 3339, ligne et type de véhicule).
 */
import type { TransitQuery } from "@/lib/scheduling/leaveBy";
import type { Place } from "@/lib/scheduling/types";

import { type FetchLike, readJson, TravelApiError, validSeconds } from "./matrix";

export const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Champs demandés (obligatoire ; limite aussi le coût). */
export const GOOGLE_ROUTES_FIELD_MASK =
  "routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails";

const NAME = "google";

/** Une ligne à prendre. */
export interface TransitLeg {
  /** « Bus », « Métro », « Train »… */
  vehicle: string;
  /** Numéro ou nom de la ligne (« 51 », « Ligne verte ») ; vide si inconnu. */
  line: string;
  /** Direction affichée sur le véhicule, si connue. */
  headsign: string;
  /** Arrêt de départ, si connu. */
  stop: string;
  /** Départ du véhicule à cet arrêt. */
  departAt: Date;
}

/** Trajet réel : départ du lieu d'origine (marche comprise), arrivée à destination. */
export interface TransitRoute {
  departAt: Date;
  arriveAt: Date;
  /** Lignes à prendre, dans l'ordre (vide : le trajet se fait à pied). */
  legs: TransitLeg[];
}

export interface GoogleRoutesOptions {
  apiKey: string;
  fetch: FetchLike;
  url?: string;
}

/** Client Compute Routes (un appel par trajet). */
export class GoogleRoutesClient {
  constructor(private readonly options: GoogleRoutesOptions) {
    if (!options.apiKey) throw new Error("Clé Google Maps manquante.");
  }

  /** Trajet en transport en commun, ou `null` si Google n'en trouve pas. Lève si l'appel échoue. */
  async transit(
    from: Place,
    to: Place,
    query: TransitQuery,
    signal?: AbortSignal,
  ): Promise<TransitRoute | null> {
    const res = await this.options.fetch(this.options.url ?? GOOGLE_ROUTES_URL, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGoogleRoutesBody(from, to, query)),
      signal,
    });
    return parseGoogleRoute(await readJson(NAME, res), query);
  }
}

const waypoint = (p: Place) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

export function buildGoogleRoutesBody(from: Place, to: Place, query: TransitQuery) {
  return {
    origin: waypoint(from),
    destination: waypoint(to),
    travelMode: "TRANSIT",
    ...("arrivalTime" in query
      ? { arrivalTime: query.arrivalTime.toISOString() }
      : { departureTime: query.departureTime.toISOString() }),
    computeAlternativeRoutes: false,
    languageCode: "fr-CA",
    units: "METRIC",
  };
}

/** Types de véhicule de Google → mot affiché. */
const VEHICLES: Readonly<Record<string, string>> = {
  BUS: "Bus",
  INTERCITY_BUS: "Autocar",
  TROLLEYBUS: "Trolleybus",
  SHARE_TAXI: "Taxi collectif",
  SUBWAY: "Métro",
  METRO_RAIL: "Métro",
  TRAM: "Tramway",
  LIGHT_RAIL: "Train léger",
  MONORAIL: "Monorail",
  RAIL: "Train",
  HEAVY_RAIL: "Train",
  COMMUTER_TRAIN: "Train de banlieue",
  HIGH_SPEED_TRAIN: "Train",
  LONG_DISTANCE_TRAIN: "Train",
  FERRY: "Traversier",
  CABLE_CAR: "Téléphérique",
  GONDOLA_LIFT: "Télécabine",
  FUNICULAR: "Funiculaire",
};

/** « 1234s » → secondes ; 0 si absent ou illisible (une étape sans durée ne décale rien). */
function seconds(v: unknown): number {
  if (typeof v !== "string") return 0;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v);
  return (m && validSeconds(Number(m[1]))) || 0;
}

function date(v: unknown): Date | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Texte court venant de Google (borné, sans caractères de contrôle). */
function text(v: unknown, max = 60): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, max);
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Lit la première route. Départ = départ du premier véhicule − marche avant lui ; arrivée =
 * arrivée du dernier véhicule + marche après lui. Trajet sans véhicule (tout à pied) : la durée
 * totale, comptée depuis l'heure demandée. `null` si aucune route.
 */
export function parseGoogleRoute(json: unknown, query: TransitQuery): TransitRoute | null {
  const body = obj(json);
  if (!body) throw new TravelApiError(NAME, "réponse inattendue");
  if (body.routes === undefined) return null; // aucune route trouvée (réponse vide)
  if (!Array.isArray(body.routes)) throw new TravelApiError(NAME, "réponse inattendue");
  const route = obj(body.routes[0]);
  if (!route) return null;

  const steps: Record<string, unknown>[] = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) {
    const l = obj(leg);
    for (const step of Array.isArray(l?.steps) ? (l.steps as unknown[]) : []) {
      const s = obj(step);
      if (s) steps.push(s);
    }
  }

  let walkBefore = 0;
  let walkAfter = 0;
  let first: Date | null = null;
  let last: Date | null = null;
  const legs: TransitLeg[] = [];
  for (const s of steps) {
    const details = s.travelMode === "TRANSIT" ? obj(s.transitDetails) : null;
    const stops = obj(details?.stopDetails);
    const dep = date(stops?.departureTime);
    const arr = date(stops?.arrivalTime);
    if (!details || !dep || !arr || arr < dep) {
      if (first === null) walkBefore += seconds(s.staticDuration);
      else walkAfter += seconds(s.staticDuration);
      continue;
    }
    first ??= dep;
    last = arr;
    walkAfter = 0;
    const line = obj(details.transitLine);
    const vehicleType = text(obj(line?.vehicle)?.type, 30);
    legs.push({
      vehicle: VEHICLES[vehicleType] ?? "Transport en commun",
      line: text(line?.nameShort, 20) || text(line?.name, 40),
      headsign: text(details.headsign),
      stop: text(obj(stops?.departureStop)?.name),
      departAt: dep,
    });
  }

  if (first && last) {
    return {
      departAt: new Date(first.getTime() - walkBefore * 1000),
      arriveAt: new Date(last.getTime() + walkAfter * 1000),
      legs,
    };
  }
  const total = seconds(route.duration);
  if (total <= 0) return null;
  if ("arrivalTime" in query) {
    return {
      departAt: new Date(query.arrivalTime.getTime() - total * 1000),
      arriveAt: query.arrivalTime,
      legs: [],
    };
  }
  return {
    departAt: query.departureTime,
    arriveAt: new Date(query.departureTime.getTime() + total * 1000),
    legs: [],
  };
}
