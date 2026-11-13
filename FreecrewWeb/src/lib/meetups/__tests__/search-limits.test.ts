/**
 * Revue de sécurité (segment 11) : le calcul « Quand on peut se voir » reste borné même si un
 * membre crée des milliers de lieux ou de blocs par l'API REST.
 */
import { describe, expect, it } from "vitest";

import type { BusyBlockInput, PlaceInput, ProfileInput } from "@/lib/db/convert";
import {
  limitCandidatePlaces,
  MAX_CANDIDATE_PLACES,
  MAX_SEARCH_BLOCKS,
  type MeetupStore,
  searchGroupMeetups,
} from "@/lib/meetups/search";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import type { Person } from "@/lib/scheduling/types";

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GROUP = uid(99);
const NOW = new Date("2026-11-02T15:00:00Z"); // lundi ; « la semaine prochaine » = 9 au 15 nov.

/** Groupe en mémoire : `n` personnes, `placesEach` lieux chacune (le premier est la maison). */
function store(n: number, placesEach: number, blocksEach: number, favorites = 0): MeetupStore {
  const ids = Array.from({ length: n }, (_, i) => uid(i + 1));
  const places: PlaceInput[] = ids.flatMap((owner_id, i) =>
    Array.from({ length: placesEach }, (_, k) => ({
      id: uid(1_000 + i * placesEach + k),
      owner_id,
      name: `Lieu ${i}-${k}`,
      lat: 45.5 + k * 1e-4,
      lng: -73.5 + i * 1e-3,
    })),
  );
  const favs: PlaceInput[] = Array.from({ length: favorites }, (_, k) => ({
    id: uid(900_000 + k),
    owner_id: ids[0],
    name: `Favori ${k}`,
    lat: 45.51,
    lng: -73.55 + k * 1e-4,
  }));
  const blocks: BusyBlockInput[] = ids.flatMap((owner_id, i) =>
    Array.from({ length: blocksEach }, (_, k) => {
      const h = String(8 + (k % 13)).padStart(2, "0");
      return {
        id: uid(5_000_000 + i * blocksEach + k),
        owner_id,
        title: "Occupé",
        place_id: places[i * placesEach].id,
        start_time: `${h}:00:00`,
        end_time: `${h}:20:00`,
        weekday: (k % 7) + 1,
        valid_from: "2026-08-25",
        valid_until: "2027-05-20",
      };
    }),
  );
  const profiles = ids.map((id, i) => ({
    id,
    display_name: `P${i}`,
    travel_mode: "transit",
    home_place_id: places[i * placesEach].id,
  })) as ProfileInput[];
  return {
    memberIds: async () => ({ ok: true, value: ids }),
    profiles: async () => ({ ok: true, value: profiles }),
    personalPlaces: async () => ({ ok: true, value: places }),
    groupPlaces: async () => ({ ok: true, value: favs }),
    groupBlocks: async () => ({ ok: true, value: blocks }),
  };
}

function search(s: MeetupStore, n: number) {
  return searchGroupMeetups(
    s,
    {
      groupId: GROUP,
      participantIds: Array.from({ length: n }, (_, i) => uid(i + 1)),
      period: "next-week",
      durationMinutes: 30,
      bufferMinutes: 5,
    },
    { userId: uid(1), now: NOW, travel: new EstimatedTravelProvider() },
  );
}

describe("Quand on peut se voir : coût borné (revue)", () => {
  it("12 000 lieux créés par deux comptes : réponse en moins de 1 s (avant : 2 s)", async () => {
    const t = performance.now();
    const r = await search(store(2, 6000, 5), 2);
    const ms = performance.now() - t;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.inPerson.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });

  it(`plus de ${MAX_SEARCH_BLOCKS} blocs dans la période : refusé avec un message clair`, async () => {
    const r = await search(store(2, 3, MAX_SEARCH_BLOCKS / 2 + 1), 2);
    expect(r).toEqual({
      ok: false,
      error:
        "L'horaire des participants a trop de blocs pour ce calcul. Choisis moins de participants.",
    });
    // Juste à la limite : accepté.
    expect((await search(store(2, 3, MAX_SEARCH_BLOCKS / 2), 2)).ok).toBe(true);
  });
});

describe("limitCandidatePlaces", () => {
  const person = (id: string, placeIds: string[]): Person => ({
    id,
    name: id,
    homePlaceId: placeIds[0],
    travelMode: "walk",
    busyBlocks: [],
    places: placeIds.map((p) => ({ id: p, name: p, lat: 45.5, lng: -73.5 })),
  });
  const fav = (id: string): PlaceInput => ({ id, owner_id: "a", name: id, lat: 45.5, lng: -73.5 });

  it("au plus la limite : aucun changement (tous les lieux, comme avant)", () => {
    const people = [person("a", ["a1", "a2"]), person("b", ["b1"])];
    expect(limitCandidatePlaces(people, [fav("f1")], 4)).toBeUndefined();
    expect(MAX_CANDIDATE_PLACES).toBeGreaterThanOrEqual(80);
  });

  it("au-delà : les maisons, puis les favoris, puis les autres lieux à tour de rôle", () => {
    const people = [person("a", ["a1", "a2", "a3", "a4"]), person("b", ["b1", "b2", "b3"])];
    expect(limitCandidatePlaces(people, [fav("f1"), fav("f2")], 6)).toEqual([
      "a1",
      "b1",
      "f1",
      "f2",
      "a2",
      "b2",
    ]);
  });
});
