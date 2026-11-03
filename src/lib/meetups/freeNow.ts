/**
 * « Je suis libre maintenant » (segment 18) : parmi les membres de mes groupes (ou d'un seul
 * groupe), qui peut me voir dans les 2 prochaines heures ? Pour chaque personne, on cherche
 * la meilleure rencontre à deux (`findMeetupSoon` : en personne, sinon un appel).
 *
 * Mêmes règles que « Quand on peut se voir » (src/lib/meetups/search.ts) : magasin injecté qui
 * lit **au nom de la personne connectée** (RLS), horaire des autres seulement par
 * `group_busy_blocks`, lieux favoris d'un groupe utilisés seulement avec les membres de ce
 * groupe, nombre de lieux, de personnes et de blocs borné.
 */
import type { BusyBlockInput, PlaceInput } from "@/lib/db/convert";
import { toPeople, toPlace } from "@/lib/db/convert";
import type { Result } from "@/lib/places/validation";
import {
  FREE_NOW_HORIZON_MINUTES,
  FREE_NOW_MIN_DURATION_MINUTES,
  findMeetupSoon,
  freeNowRange,
} from "@/lib/scheduling/freeNow";
import { minutesBetween } from "@/lib/scheduling/time";
import { prefetchRequestsFor } from "@/lib/scheduling/travel";
import type { Person } from "@/lib/scheduling/types";

import {
  clockLabel,
  DEFAULT_BUFFER_MINUTES,
  dayLabel,
  limitCandidatePlaces,
  MAX_CANDIDATE_PLACES,
  type MeetupStore,
  type SearchDeps,
  type StoreResult,
} from "./search";

/** Groupes lus au plus (les plus anciens d'abord). */
export const MAX_FREE_NOW_GROUPS = 10;
/** Personnes essayées au plus (sans moi) : un calcul à deux par personne. */
export const MAX_FREE_NOW_PEOPLE = 40;

/** Lectures nécessaires : celles de la recherche du groupe, plus la liste de mes groupes. */
export interface FreeNowStore extends MeetupStore {
  /** Mes groupes (RLS : seulement ceux dont je suis membre), du plus ancien au plus récent. */
  myGroups(): Promise<StoreResult<{ id: string; name: string }[]>>;
}

/** Demande validée : tous mes groupes, ou un seul. */
export interface FreeNowInput {
  groupId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valide la demande (`{ groupId?: string }`). */
export function validateFreeNow(raw: unknown): Result<FreeNowInput> {
  if (raw === undefined || raw === null) return { ok: true, value: { groupId: null } };
  if (typeof raw !== "object") return { ok: false, error: "Demande invalide." };
  const g = (raw as Record<string, unknown>).groupId;
  if (g === undefined || g === null || g === "") return { ok: true, value: { groupId: null } };
  if (typeof g !== "string" || !UUID.test(g)) return { ok: false, error: "Groupe introuvable." };
  return { ok: true, value: { groupId: g.toLowerCase() } };
}

/** Une personne que je peux voir bientôt (sérialisable). */
export interface FreeNowMatchView {
  personId: string;
  name: string;
  /** Groupes en commun (noms). */
  groups: string[];
  kind: "in-person" | "call";
  placeId: string | null;
  placeName: string | null;
  start: string;
  end: string;
  /** « 14 h 15 – 16 h » */
  timeLabel: string;
  /** « lundi 15 septembre » (utile quand l'horizon passe minuit). */
  dayLabel: string;
  durationMinutes: number;
  /** Mon trajet aller et le sien, en minutes (sans la marge). */
  myTravel: number;
  theirTravel: number;
}

export interface FreeNowView {
  /** Début et fin de la fenêtre cherchée (ISO). */
  from: string;
  until: string;
  /** « 14 h 05 – 16 h 05 » */
  windowLabel: string;
  /** Personnes avec qui c'est possible, de la plus tôt à la plus tard. */
  matches: FreeNowMatchView[];
  /** Nombre de personnes essayées (sans moi). */
  checked: number;
  /** Membres sans lieu « maison » (pas de calcul possible), par nom. */
  incomplete: string[];
  /** Vrai si des groupes ou des personnes ont été laissés de côté (limites). */
  truncated: boolean;
}

export interface FreeNowDeps extends SearchDeps {
  horizonMinutes?: number;
  minDurationMinutes?: number;
}

/**
 * Cherche qui, parmi les membres de mes groupes (ou du groupe `input.groupId`), peut me voir
 * dans les prochaines heures. Refuse si je ne suis pas membre du groupe demandé, ou si je n'ai
 * pas encore de lieu « maison ».
 */
export async function searchFreeNow(
  store: FreeNowStore,
  input: FreeNowInput,
  deps: FreeNowDeps,
): Promise<Result<FreeNowView>> {
  const horizon = deps.horizonMinutes ?? FREE_NOW_HORIZON_MINUTES;
  const minDuration = deps.minDurationMinutes ?? FREE_NOW_MIN_DURATION_MINUTES;
  const until = new Date(deps.now.getTime() + horizon * 60_000);

  const mine = await store.myGroups();
  if (!mine.ok) return mine;
  let groups = mine.value;
  if (input.groupId !== null) {
    groups = groups.filter((g) => g.id === input.groupId);
    if (groups.length === 0) return { ok: false, error: "Groupe introuvable." };
  }
  let truncated = groups.length > MAX_FREE_NOW_GROUPS;
  groups = groups.slice(0, MAX_FREE_NOW_GROUPS);

  const perGroup = await Promise.all(
    groups.map(async (g) => {
      const [members, favorites, blocks] = await Promise.all([
        store.memberIds(g.id),
        store.groupPlaces(g.id),
        store.groupBlocks(g.id),
      ]);
      return { group: g, members, favorites, blocks };
    }),
  );

  // Qui est dans quels groupes (défense en profondeur : je dois être membre de chacun).
  const groupsOf = new Map<string, string[]>();
  const favoritesOf = new Map<string, PlaceInput[]>();
  const blockById = new Map<string, BusyBlockInput>();
  const memberGroups: { id: string; members: string[]; favorites: PlaceInput[] }[] = [];
  for (const { group, members, favorites, blocks } of perGroup) {
    if (!members.ok) return members;
    if (!favorites.ok) return favorites;
    if (!blocks.ok) return blocks;
    if (!members.value.includes(deps.userId)) continue;
    const memberSet = new Set(members.value);
    memberGroups.push({ id: group.id, members: members.value, favorites: favorites.value });
    for (const id of members.value) {
      if (id === deps.userId) continue;
      groupsOf.set(id, [...(groupsOf.get(id) ?? []), group.name]);
      favoritesOf.set(id, [...(favoritesOf.get(id) ?? []), ...favorites.value]);
    }
    for (const b of blocks.value) if (memberSet.has(b.owner_id)) blockById.set(b.id, b);
  }

  let others = [...groupsOf.keys()];
  if (others.length > MAX_FREE_NOW_PEOPLE) {
    truncated = true;
    others = others.slice(0, MAX_FREE_NOW_PEOPLE);
  }
  const base: FreeNowView = {
    from: deps.now.toISOString(),
    until: until.toISOString(),
    windowLabel: `${clockLabel(deps.now)} – ${clockLabel(until)}`,
    matches: [],
    checked: 0,
    incomplete: [],
    truncated,
  };
  if (others.length === 0) return { ok: true, value: base };

  const ids = [deps.userId, ...others];
  const idSet = new Set(ids);
  const [profiles, personal] = await Promise.all([store.profiles(ids), store.personalPlaces(ids)]);
  if (!profiles.ok) return profiles;
  if (!personal.ok) return personal;

  const range = freeNowRange(deps.now, horizon);
  // Coût borné : au plus 1 + MAX_FREE_NOW_PEOPLE personnes (1000 blocs chacune au plus,
  // migration 0008), dépliés sur un ou deux jours seulement.
  const blockRows = [...blockById.values()].filter((b) => idSet.has(b.owner_id));
  const allFavorites = dedupeById(memberGroups.flatMap((g) => g.favorites));
  const placeRows = dedupeById([
    ...personal.value.filter((p) => idSet.has(p.owner_id)),
    ...allFavorites,
  ]);
  const profileRows = profiles.value.filter((p) => idSet.has(p.id));
  const converted = toPeople(profileRows, placeRows, blockRows, range);
  const byId = new Map(converted.people.map((p) => [p.id, p]));

  const me = byId.get(deps.userId);
  if (!me) {
    return {
      ok: false,
      error: "Choisis d'abord ton lieu « maison » (page Mes lieux) pour que le calcul marche.",
    };
  }
  const nameOf = new Map(profileRows.map((p) => [p.id, p.display_name || "Sans nom"]));
  base.incomplete = converted.incomplete
    .filter((i) => i.id !== deps.userId)
    .map((i) => nameOf.get(i.id) ?? "Membre");

  // Vrais temps de trajet (segment 15) : une préparation par groupe, avant les calculs.
  // Au-delà de ma limite d'appels du jour, les trajets sont estimés (FallbackTravelProvider).
  if (deps.travel.prefetch) {
    for (const g of memberGroups) {
      const people = g.members.flatMap((id) => byId.get(id) ?? []);
      const favorites = g.favorites.map(toPlace);
      if (people.length < 2) continue;
      await deps.travel
        .prefetch(
          prefetchRequestsFor(
            people,
            favorites,
            limitCandidatePlaces(people, g.favorites, MAX_CANDIDATE_PLACES),
          ),
          // Limite d'appels d'API par personne (revue 15.1) : chaque groupe compte pour moi.
          { budgetKey: deps.userId },
        )
        .catch((e: unknown) => console.warn("Temps de trajet (préparation) :", e));
    }
  }

  const placeName = new Map(placeRows.map((p) => [p.id, p.name]));
  const matches: FreeNowMatchView[] = [];
  let checked = 0;
  for (const id of others) {
    const other = byId.get(id);
    if (!other) continue;
    checked++;
    const favorites = dedupeById(favoritesOf.get(id) ?? []);
    const pair: Person[] = [me, other];
    const best = await findMeetupSoon(
      pair,
      {
        now: deps.now,
        horizonMinutes: horizon,
        minDurationMinutes: minDuration,
        bufferMinutes: DEFAULT_BUFFER_MINUTES,
        dayHours: deps.dayHours,
        favoritePlaces: favorites.map(toPlace),
        candidatePlaceIds: limitCandidatePlaces(pair, favorites, MAX_CANDIDATE_PLACES),
      },
      deps.travel,
    );
    if (!best) continue;
    matches.push({
      personId: id,
      name: nameOf.get(id) ?? "Membre",
      groups: groupsOf.get(id) ?? [],
      kind: best.kind,
      placeId: best.placeId,
      placeName: best.placeId ? (placeName.get(best.placeId) ?? "Lieu") : null,
      start: best.start.toISOString(),
      end: best.end.toISOString(),
      timeLabel: `${clockLabel(best.start)} – ${clockLabel(best.end)}`,
      dayLabel: dayLabel(best.start),
      durationMinutes: Math.round(minutesBetween(best.start, best.end)),
      myTravel: best.travelByPerson[me.id]?.to ?? 0,
      theirTravel: best.travelByPerson[id]?.to ?? 0,
    });
  }
  matches.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      Number(a.kind === "call") - Number(b.kind === "call") ||
      a.name.localeCompare(b.name, "fr-CA"),
  );
  return { ok: true, value: { ...base, matches, checked } };
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) seen.set(r.id, r);
  return [...seen.values()];
}
