/**
 * Jeux de données de Freecrew : une petite bande d'amis fictifs (région de Montréal) dont les
 * horaires sont construits pour produire, chacun, un cas précis du cœur de l'app : réussite,
 * cas limite ou erreur. Les scénarios sont expliqués dans `docs/jeux-de-donnees.md` et
 * vérifiés dans `src/lib/scheduling/__tests__/scenarios.test.ts`.
 *
 * Les données sont écrites comme des lignes de la BD (profils, lieux, blocs, disponibilités),
 * avec des jours RELATIFS à une semaine de référence (lundi = jour 0). `materialize(lundi)` les
 * date pour une semaine donnée :
 * - les tests prennent une semaine fixe (`REFERENCE_MONDAY`), ou la semaine du changement
 *   d'heure (`DST_FALL_MONDAY`) ;
 * - le script `scripts/seed-test-data.mjs` prend le prochain lundi, pour qu'on puisse essayer
 *   les scénarios à la main dans l'app, sur une base Supabase de TEST.
 *
 * Règle de ce fichier : aucun `import` qui s'exécute (seulement `import type`), pour que Node
 * puisse le lire directement depuis le script de seed, sans compilation.
 */
import type {
  AvailabilitySlotInput,
  BusyBlockInput,
  PlaceInput,
  ProfileInput,
} from "../db/convert";
import type { TravelMode } from "../scheduling/types";

// ─── Semaines ───────────────────────────────────────────────────────────────────────────

/** Semaine de référence des tests : du lundi 23 au dimanche 29 novembre 2026 (heure normale). */
export const REFERENCE_MONDAY = "2026-11-23";
/** Semaine du retour à l'heure normale : le dimanche 1er novembre 2026 dure 25 h. */
export const DST_FALL_MONDAY = "2026-10-26";
/** Semaine du passage à l'heure avancée : le dimanche 8 mars 2026 dure 23 h. */
export const DST_SPRING_MONDAY = "2026-03-02";

export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type DayKey = (typeof DAYS)[number];

/** Décalage en jours depuis le lundi (lun = 0 … dim = 6). */
export function dayOffset(day: DayKey): number {
  return DAYS.indexOf(day);
}

/** `yyyy-MM-dd` + n jours (calendrier pur, sans fuseau). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** Jour local d'un jour de la semaine qui commence `monday` (`week` = semaines plus tard). */
export function dayOf(monday: string, day: DayKey, week = 0): string {
  return addDays(monday, dayOffset(day) + 7 * week);
}

/** Lundi suivant `today` (ou `today` si c'est un lundi), pour le seed. */
export function nextMonday(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const iso = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; // 1 = lundi
  return iso === 1 ? today : addDays(today, 8 - iso);
}

// ─── Description des données ───────────────────────────────────────────────────────────

export interface DataPlace {
  /** Clé unique, aussi utilisée comme identifiant dans les tests (ex. « ali.maison »). */
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Un bloc occupé, avec des jours relatifs à la semaine de référence. */
export type DataBlock = {
  key: string;
  title: string;
  /** Clé du lieu ; `null` = la maison. Un lieu absent de `places` = lieu supprimé. */
  place: string | null;
  /** « HH:mm » (« 24:00 » permis pour la fin). */
  start: string;
  end: string;
} & (
  | {
      kind: "weekly";
      day: DayKey;
      /** Une semaine sur X (défaut 1), comptée depuis le début de la session. */
      every?: number;
      /** Occurrences annulées (« cours annulé cette fois-ci »), dans la semaine de référence. */
      skip?: DayKey[];
    }
  /** Ponctuel : un seul jour (`week` semaines après la semaine de référence). */
  | { kind: "once"; day: DayKey; week?: number }
  /** Chaque mois, à la même date que ce jour de la semaine de référence. */
  | { kind: "monthly"; day: DayKey }
);

export interface DataAvailability {
  key: string;
  day: DayKey;
  start: string;
  end: string;
  note: string;
}

export interface DataPerson {
  key: string;
  name: string;
  /** Nom d'utilisateur (règle de l'app : 3 à 20, minuscules, chiffres, « _ », « . »). */
  username: string;
  travelMode: TravelMode;
  /** Clé du lieu maison ; `null` = profil incomplet (pas de maison). */
  home: string | null;
  places: DataPlace[];
  blocks: DataBlock[];
  /** « Je ne sors pas » avant / après (« HH:mm »). */
  quiet?: { before?: string; after?: string };
  /** Limite de sorties. */
  outings?: { perDay?: number; perWeek?: number };
  availabilities?: DataAvailability[];
  /** Lieux à supprimer APRÈS avoir créé les blocs (cas « lieu supprimé »), seed seulement. */
  deletedPlaces?: DataPlace[];
}

export interface DataGroup {
  key: string;
  name: string;
  /** Crée le groupe (admin). */
  creator: string;
  /** Les autres membres (ils rejoignent avec le code d'invitation). */
  members: string[];
}

export interface DataPlan {
  key: string;
  group: string;
  proposer: string;
  title: string;
  day: DayKey;
  start: string;
  end: string;
  /** Lieu de la personne qui propose (clé), ou `null` avec un texte libre. */
  place: string | null;
  location: string;
  /** Personnes qui acceptent (la personne qui propose y va d'office). */
  accepted: string[];
  /** Personnes qui refusent. */
  declined: string[];
}

/** Blocs ajoutés APRÈS l'acceptation des plans (« l'horaire change après coup »). */
export interface DataLateBlock {
  person: string;
  block: DataBlock;
}

// ─── Lieux ─────────────────────────────────────────────────────────────────────────────

const place = (id: string, name: string, lat: number, lng: number): DataPlace => ({
  id,
  name,
  lat,
  lng,
});

export const P = {
  aliHome: place("ali.maison", "Maison d'ali (Vieux-Longueuil)", 45.5369, -73.5107),
  aliCegep: place("ali.cegep", "Cégep Édouard-Montpetit", 45.5364, -73.495),
  aliCafe: place("ali.cafe", "Café rue Saint-Charles", 45.5379, -73.5094),
  samHome: place("sam.maison", "Maison de Sam (Saint-Lambert)", 45.5007, -73.5076),
  /** Même cégep qu'ali, enregistré par Sam : même endroit, donc trajet de 0 entre les deux. */
  samCegep: place("sam.cegep", "Cégep Édouard-Montpetit", 45.5364, -73.495),
  mayaHome: place("maya.maison", "Maison de Maya (Plateau-Mont-Royal)", 45.5226, -73.5822),
  mayaUdem: place("maya.udem", "Université de Montréal", 45.5048, -73.6132),
  leoHome: place("leo.maison", "Maison de Léo (Chomedey, Laval)", 45.5412, -73.7458),
  leoWork: place("leo.travail", "Carrefour Laval", 45.5712, -73.7524),
  noraHome: place("nora.maison", "Maison de Nora (Longueuil, près du cégep)", 45.533, -73.499),
  zoeLibrary: place("zoe.biblio", "Grande Bibliothèque", 45.5153, -73.5622),
  felixHome: place("felix.maison", "Maison de Félix (Sherbrooke)", 45.4042, -71.8929),
  jadeHome: place("jade.maison", "Maison de Jade (Longueuil)", 45.525, -73.515),
  hugoHome: place("hugo.maison", "Maison de Hugo (Brossard)", 45.458, -73.466),
  hugoHospital: place("hugo.hopital", "Hôpital Charles-LeMoyne", 45.499, -73.487),
  linaHome: place("lina.maison", "Maison de Lina (Verdun)", 45.459, -73.57),
  linaWork: place("lina.travail", "Marché Atwater", 45.4805, -73.577),
  /** Lieu supprimé par Lina après y avoir mis un bloc. */
  linaOldStudio: place("lina.ancien-studio", "Ancien studio (supprimé)", 45.47, -73.58),
} as const;

const weekly = (
  key: string,
  day: DayKey,
  start: string,
  end: string,
  title: string,
  placeKey: string | null,
  extra: { every?: number; skip?: DayKey[] } = {},
): DataBlock => ({ key, kind: "weekly", day, start, end, title, place: placeKey, ...extra });

const once = (
  key: string,
  day: DayKey,
  start: string,
  end: string,
  title: string,
  placeKey: string | null,
  week = 0,
): DataBlock => ({ key, kind: "once", day, start, end, title, place: placeKey, week });

// ─── Personnes ─────────────────────────────────────────────────────────────────────────

const CEGEP_A = P.aliCegep.id;
const CEGEP_S = P.samCegep.id;

export const PEOPLE: readonly DataPerson[] = [
  {
    key: "ali",
    name: "ali",
    username: "ali_test",
    travelMode: "transit",
    home: P.aliHome.id,
    places: [P.aliHome, P.aliCegep, P.aliCafe],
    blocks: [
      weekly("ali.lun1", "lun", "08:00", "10:00", "Chimie générale", CEGEP_A),
      weekly("ali.lun2", "lun", "13:00", "16:00", "Philosophie", CEGEP_A),
      weekly("ali.mar1", "mar", "08:00", "12:00", "Biologie (labo)", CEGEP_A),
      weekly("ali.mar2", "mar", "12:45", "15:00", "Français", CEGEP_A),
      weekly("ali.mer1", "mer", "08:00", "10:00", "Physique mécanique", CEGEP_A),
      weekly("ali.mer2", "mer", "13:00", "15:00", "Anglais", CEGEP_A),
      weekly("ali.jeu1", "jeu", "10:00", "12:00", "Calcul intégral", CEGEP_A),
      weekly("ali.ven1", "ven", "08:00", "12:00", "Éducation physique", CEGEP_A),
      weekly("ali.ven2", "ven", "12:00", "15:00", "Calcul différentiel", CEGEP_A),
    ],
  },
  {
    key: "sam",
    name: "Sam",
    username: "sam_test",
    travelMode: "bike",
    home: P.samHome.id,
    places: [P.samHome, P.samCegep],
    blocks: [
      weekly("sam.lun1", "lun", "08:00", "11:00", "Techniques de l'informatique", CEGEP_S),
      weekly("sam.lun2", "lun", "13:00", "15:00", "Mathématiques discrètes", CEGEP_S),
      weekly("sam.mar1", "mar", "08:00", "12:00", "Programmation", CEGEP_S),
      weekly("sam.mar2", "mar", "12:45", "17:00", "Bases de données", CEGEP_S),
      // Deux blocs qui se chevauchent (10 h à 11 h) : ils doivent être fusionnés.
      weekly("sam.jeu1", "jeu", "08:00", "11:00", "Programmation web", CEGEP_S),
      weekly("sam.jeu2", "jeu", "10:00", "12:00", "Labo de réseaux", CEGEP_S),
    ],
  },
  {
    key: "maya",
    name: "Maya",
    username: "maya_test",
    travelMode: "transit",
    home: P.mayaHome.id,
    places: [P.mayaHome, P.mayaUdem],
    blocks: [
      weekly("maya.lun1", "lun", "08:30", "11:30", "Psychologie cognitive", P.mayaUdem.id),
      weekly("maya.mer1", "mer", "08:00", "10:00", "Méthodes de recherche", P.mayaUdem.id),
      weekly("maya.mer2", "mer", "13:00", "16:00", "Neurosciences", P.mayaUdem.id),
    ],
  },
  {
    key: "leo",
    name: "Léo",
    username: "leo_test",
    travelMode: "car",
    home: P.leoHome.id,
    places: [P.leoHome, P.leoWork],
    blocks: [
      weekly("leo.lun1", "lun", "12:00", "20:00", "Travail", P.leoWork.id),
      weekly("leo.mer1", "mer", "12:00", "20:00", "Travail", P.leoWork.id),
      weekly("leo.ven1", "ven", "15:00", "22:00", "Travail", P.leoWork.id),
      weekly("leo.sam1", "sam", "10:00", "18:00", "Travail", P.leoWork.id),
      weekly("leo.dim1", "dim", "11:00", "17:00", "Travail", P.leoWork.id),
    ],
  },
  {
    // Horaire vide : libre tout le temps.
    key: "nora",
    name: "Nora",
    username: "nora_test",
    travelMode: "walk",
    home: P.noraHome.id,
    places: [P.noraHome],
    blocks: [],
  },
  {
    // Profil incomplet : aucun lieu maison choisi.
    key: "zoe",
    name: "Zoé",
    username: "zoe_test",
    travelMode: "transit",
    home: null,
    places: [P.zoeLibrary],
    blocks: [weekly("zoe.lun1", "lun", "09:00", "12:00", "Lecture", P.zoeLibrary.id)],
  },
  {
    // Habite à Sherbrooke et se déplace à pied : tout trajet vers Longueuil est trop long.
    key: "felix",
    name: "Félix",
    username: "felix_test",
    travelMode: "walk",
    home: P.felixHome.id,
    places: [P.felixHome],
    blocks: [],
  },
  {
    // Ne sort pas avant 10 h ni après 20 h, et au plus une sortie par jour.
    key: "jade",
    name: "Jade",
    username: "jade_test",
    travelMode: "transit",
    home: P.jadeHome.id,
    places: [P.jadeHome],
    blocks: [],
    quiet: { before: "10:00", after: "20:00" },
    outings: { perDay: 1 },
  },
  {
    // Quart de nuit du vendredi 22 h au samedi 6 h : deux blocs, de part et d'autre de minuit.
    key: "hugo",
    name: "Hugo",
    username: "hugo_test",
    travelMode: "car",
    home: P.hugoHome.id,
    places: [P.hugoHome, P.hugoHospital],
    blocks: [
      weekly("hugo.ven1", "ven", "22:00", "24:00", "Quart de nuit", P.hugoHospital.id),
      weekly("hugo.sam1", "sam", "00:00", "06:00", "Quart de nuit (suite)", P.hugoHospital.id),
    ],
  },
  {
    // Récurrences personnalisées, cours annulé, disponibilité ponctuelle et lieu supprimé.
    key: "lina",
    name: "Lina",
    username: "lina_test",
    travelMode: "transit",
    home: P.linaHome.id,
    places: [P.linaHome, P.linaWork],
    blocks: [
      weekly("lina.sam1", "sam", "09:00", "17:00", "Travail", P.linaWork.id),
      weekly("lina.jeu1", "jeu", "18:00", "20:00", "Club d'échecs", null, { every: 2 }),
      weekly("lina.mer1", "mer", "09:00", "12:00", "Cours de dessin", P.linaWork.id, {
        skip: ["mer"],
      }),
      {
        key: "lina.dentiste",
        kind: "monthly",
        day: "mar",
        start: "15:00",
        end: "16:00",
        title: "Dentiste",
        place: P.linaOldStudio.id,
      },
    ],
    availabilities: [
      { key: "lina.dispo", day: "sam", start: "13:00", end: "16:00", note: "Pause au travail" },
    ],
    deletedPlaces: [P.linaOldStudio],
  },
];

// ─── Groupes et plans ──────────────────────────────────────────────────────────────────

export const GROUPS: readonly DataGroup[] = [
  { key: "cegep", name: "Pauses du cégep", creator: "ali", members: ["sam"] },
  { key: "ali-maya", name: "ali et Maya", creator: "ali", members: ["maya"] },
  { key: "ali-leo", name: "ali et Léo", creator: "ali", members: ["leo"] },
  { key: "loin", name: "Trop loin (Félix)", creator: "ali", members: ["felix"] },
  { key: "quatre", name: "Les quatre", creator: "ali", members: ["sam", "maya", "leo"] },
  { key: "solo", name: "Juste moi", creator: "ali", members: [] },
  { key: "zoe", name: "Avec Zoé (sans maison)", creator: "ali", members: ["zoe"] },
  { key: "calmes", name: "Jade et Nora", creator: "nora", members: ["jade"] },
  { key: "lina-nora", name: "Lina et Nora", creator: "nora", members: ["lina"] },
  { key: "nuit", name: "Hugo et Nora", creator: "nora", members: ["hugo"] },
  // Disponibilité dans un groupe (S29 à S40) : tout le monde, avec tous les cas à la fois
  // (sans maison, trop loin, heures calmes, quart de nuit, disponibilité ponctuelle).
  {
    key: "bande",
    name: "Toute la bande",
    creator: "ali",
    members: ["sam", "maya", "leo", "nora", "zoe", "felix", "jade", "hugo", "lina"],
  },
];

export const PLANS: readonly DataPlan[] = [
  {
    key: "souper-cafe",
    group: "cegep",
    proposer: "ali",
    title: "Souper au café",
    day: "jeu",
    start: "18:00",
    end: "20:00",
    place: P.aliCafe.id,
    location: "",
    accepted: ["sam"],
    declined: [],
  },
  {
    key: "marche-parc",
    group: "calmes",
    proposer: "nora",
    title: "Marche au parc",
    day: "dim",
    start: "14:00",
    end: "16:00",
    place: null,
    location: "Parc Michel-Chartrand",
    accepted: ["jade"],
    declined: [],
  },
  {
    key: "cinema",
    group: "quatre",
    proposer: "ali",
    title: "Cinéma",
    day: "sam",
    start: "19:00",
    end: "21:30",
    place: null,
    location: "Cinéma Quartier Latin",
    accepted: ["maya"],
    declined: ["leo"],
  },
];

/** Sam reçoit un quart de travail pendant le souper déjà accepté : le plan est « à revoir ». */
export const LATE_BLOCKS: readonly DataLateBlock[] = [
  {
    person: "sam",
    block: once("sam.quart", "jeu", "17:00", "21:00", "Quart de travail", P.samHome.id),
  },
];

// ─── Lignes de la BD, datées ───────────────────────────────────────────────────────────

/** Les lignes de la BD d'une semaine donnée (identifiants = clés, pour les tests). */
export interface Materialized {
  monday: string;
  /** Les 7 jours de la semaine (`yyyy-MM-dd`). */
  week: { from: string; to: string };
  profiles: ProfileInput[];
  places: PlaceInput[];
  /** Blocs de l'horaire, plans acceptés compris (`source = 'meetup'`), sans les blocs tardifs. */
  blocks: BusyBlockInput[];
  /** Les blocs ajoutés après coup (`LATE_BLOCKS`). */
  lateBlocks: BusyBlockInput[];
  availabilities: AvailabilitySlotInput[];
}

/** Début et fin de la session des blocs hebdomadaires (moins d'un an, règle de la BD). */
export function sessionOf(monday: string): { from: string; until: string } {
  return { from: addDays(monday, -28), until: addDays(monday, 7 * 12 + 6) };
}

const pgTime = (hhmm: string) => `${hhmm}:00`;

/** Un bloc de données → colonnes de `busy_blocks` (jours datés). */
export function blockRow(
  owner: string,
  b: DataBlock,
  monday: string,
): BusyBlockInput & { source: string } {
  const base = {
    id: b.key,
    owner_id: owner,
    title: b.title,
    place_id: b.place,
    start_time: pgTime(b.start),
    end_time: pgTime(b.end),
    source: "manual",
  };
  if (b.kind === "once") {
    const day = dayOf(monday, b.day, b.week ?? 0);
    return {
      ...base,
      weekday: null,
      valid_from: day,
      valid_until: day,
      repeat_unit: null,
      repeat_every: 1,
    };
  }
  if (b.kind === "monthly") {
    const day = dayOf(monday, b.day);
    return {
      ...base,
      weekday: null,
      valid_from: day,
      valid_until: addDays(day, 360),
      repeat_unit: "month",
      repeat_every: 1,
    };
  }
  const session = sessionOf(monday);
  const every = b.every ?? 1;
  return {
    ...base,
    weekday: dayOffset(b.day) + 1,
    valid_from: session.from,
    valid_until: session.until,
    repeat_unit: every > 1 ? "week" : null,
    repeat_every: every,
    skip_days: (b.skip ?? []).map((d) => dayOf(monday, d)),
  };
}

/** Blocs « sortie » créés par la BD quand on accepte un plan (un par personne qui y va). */
export function planRows(plan: DataPlan, monday: string): (BusyBlockInput & { source: string })[] {
  const day = dayOf(monday, plan.day);
  return [plan.proposer, ...plan.accepted].map((owner) => ({
    id: `${plan.key}.${owner}`,
    owner_id: owner,
    title: plan.title,
    place_id: plan.place,
    start_time: pgTime(plan.start),
    end_time: pgTime(plan.end),
    weekday: null,
    valid_from: day,
    valid_until: day,
    repeat_unit: null,
    repeat_every: 1,
    source: "meetup",
  }));
}

/** Toutes les lignes de la BD pour la semaine qui commence `monday`. */
export function materialize(monday: string = REFERENCE_MONDAY): Materialized {
  const profiles: ProfileInput[] = PEOPLE.map((p) => ({
    id: p.key,
    display_name: p.name,
    travel_mode: p.travelMode,
    home_place_id: p.home,
    unavailable_before: p.quiet?.before ? pgTime(p.quiet.before) : null,
    unavailable_after: p.quiet?.after ? pgTime(p.quiet.after) : null,
    max_outings_per_day: p.outings?.perDay ?? null,
    max_outings_per_week: p.outings?.perWeek ?? null,
  }));
  const places: PlaceInput[] = PEOPLE.flatMap((p) =>
    p.places.map((pl) => ({
      id: pl.id,
      owner_id: p.key,
      name: pl.name,
      lat: pl.lat,
      lng: pl.lng,
    })),
  );
  const blocks: BusyBlockInput[] = [
    ...PEOPLE.flatMap((p) => p.blocks.map((b) => blockRow(p.key, b, monday))),
    ...PLANS.flatMap((plan) => planRows(plan, monday)),
  ];
  const lateBlocks = LATE_BLOCKS.map((l) => blockRow(l.person, l.block, monday));
  const availabilities: AvailabilitySlotInput[] = PEOPLE.flatMap((p) =>
    (p.availabilities ?? []).map((a) => ({
      id: a.key,
      owner_id: p.key,
      day: dayOf(monday, a.day),
      start_time: pgTime(a.start),
      end_time: pgTime(a.end),
    })),
  );
  return {
    monday,
    week: { from: monday, to: addDays(monday, 6) },
    profiles,
    places,
    blocks,
    lateBlocks,
    availabilities,
  };
}

/** Membres d'un groupe (créateur d'abord). */
export function groupMembers(groupKey: string): string[] {
  const g = GROUPS.find((x) => x.key === groupKey);
  if (!g) throw new Error(`Groupe inconnu : ${groupKey}`);
  return [g.creator, ...g.members];
}
