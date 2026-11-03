/**
 * Segment 15 : avec une clé d'API, les trajets affichés sont ceux de l'API ; sans clé, ceux de
 * l'estimation, comme avant. L'API est simulée (forme réelle de la réponse ORS).
 */
import { describe, expect, it } from "vitest";

import type { PlaceInput, ProfileInput } from "@/lib/db/convert";
import { type MeetupStore, searchGroupMeetups } from "@/lib/meetups/search";
import { estimateTravelMinutes, type TravelTimeProvider } from "@/lib/scheduling/travel";
import { createTravelProvider } from "@/lib/travel/env";
import { fakeFetch, json, orsResponse } from "@/lib/travel/__tests__/fakeFetch";

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GROUP = uid(99);
const NOW = new Date("2026-11-02T15:00:00Z");
const [A, B] = [uid(1), uid(2)];

const places: PlaceInput[] = [
  { id: uid(11), owner_id: A, name: "Maison A", lat: 45.5369, lng: -73.5107 },
  { id: uid(12), owner_id: B, name: "Maison B", lat: 45.5226, lng: -73.5822 },
];
const store: MeetupStore = {
  memberIds: async () => ({ ok: true, value: [A, B] }),
  profiles: async () => ({
    ok: true,
    value: [
      { id: A, display_name: "A", travel_mode: "walk", home_place_id: uid(11) },
      { id: B, display_name: "B", travel_mode: "walk", home_place_id: uid(12) },
    ] as ProfileInput[],
  }),
  personalPlaces: async () => ({ ok: true, value: places }),
  groupPlaces: async () => ({ ok: true, value: [] }),
  groupBlocks: async () => ({ ok: true, value: [] }),
};

const search = (travel: TravelTimeProvider) =>
  searchGroupMeetups(
    store,
    {
      groupId: GROUP,
      participantIds: [A, B],
      period: "next-week",
      durationMinutes: 60,
      bufferMinutes: 5,
    },
    { userId: A, now: NOW, travel },
  );

const legs = (r: Awaited<ReturnType<typeof search>>) =>
  r.ok ? r.value.inPerson.flatMap((p) => p.travel.flatMap((t) => [t.to, t.from])) : [];

describe("Quand on peut se voir : vrai temps de trajet", () => {
  const estimated = estimateTravelMinutes(
    { id: "a", name: "", lat: 45.5369, lng: -73.5107 },
    { id: "b", name: "", lat: 45.5226, lng: -73.5822 },
    "walk",
  );

  it("sans clé : les trajets de l'estimation, aucun appel", async () => {
    const fetch = fakeFetch(() => json({}));
    const r = await search(createTravelProvider({}, fetch));
    expect(r.ok && r.value.inPerson.length).toBeGreaterThan(0);
    expect(new Set(legs(r).filter((m) => m > 0))).toEqual(new Set([estimated]));
    expect(fetch.calls).toHaveLength(0);
  });

  it("avec une clé ORS : les trajets de l'API (une seule matrice)", async () => {
    const fetch = fakeFetch((c) => json(orsResponse(c.body, (i, j) => (i === j ? 0 : 1500))));
    const r = await search(createTravelProvider({ ORS_API_KEY: "k" }, fetch));
    expect(r.ok && r.value.inPerson.length).toBeGreaterThan(0);
    expect(new Set(legs(r).filter((m) => m > 0))).toEqual(new Set([25]));
    expect(25).not.toBe(estimated);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toContain("/v2/matrix/foot-walking");
  });

  it("API en panne : la recherche marche quand même, avec l'estimation", async () => {
    const fetch = fakeFetch(() => json({ error: "Quota exceeded" }, 403));
    const travel = createTravelProvider({ ORS_API_KEY: "k" }, fetch);
    const original = console.warn;
    console.warn = () => {};
    try {
      const r = await search(travel);
      expect(new Set(legs(r).filter((m) => m > 0))).toEqual(new Set([estimated]));
    } finally {
      console.warn = original;
    }
  });
});
