/**
 * Magasin en mémoire construit à partir des jeux de données (`freecrew.ts`), pour faire tourner
 * « Quand on peut se voir » (`searchGroupMeetups`) et « Je suis libre maintenant »
 * (`searchFreeNow`) de bout en bout sur la bande, sans base de données.
 *
 * Il imite ce que la RLS laisse lire à la personne connectée : seulement les groupes dont elle
 * est membre, et l'horaire des autres seulement par un groupe en commun. La vraie RLS est
 * vérifiée à part, sur PGlite (`src/lib/db/__tests__/meetups.test.ts` et `seed.test.ts`).
 *
 * Identifiants : les clés des jeux de données (« ali », « bande »…).
 */
import type { FreeNowStore } from "../meetups/freeNow";
import { GROUPS, groupMembers, type Materialized } from "./freecrew";

type Ok<T> = { ok: true; value: T };
const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Magasin vu par `viewer` (clé d'une personne) pour la semaine `data`. */
export function datasetStore(data: Materialized, viewer: string): FreeNowStore {
  const isMember = (groupKey: string) => groupMembers(groupKey).includes(viewer);
  const membersOf = (groupKey: string) => (isMember(groupKey) ? groupMembers(groupKey) : []);
  return {
    async myGroups() {
      return ok(GROUPS.filter((g) => isMember(g.key)).map((g) => ({ id: g.key, name: g.name })));
    },
    async memberIds(groupId) {
      return ok(membersOf(groupId));
    },
    async profiles(ids) {
      return ok(data.profiles.filter((p) => ids.includes(p.id)));
    },
    async personalPlaces(ownerIds) {
      return ok(data.places.filter((p) => ownerIds.includes(p.owner_id)));
    },
    async groupPlaces() {
      return ok([]);
    },
    async groupBlocks(groupId) {
      const members = membersOf(groupId);
      return ok(data.blocks.filter((b) => members.includes(b.owner_id)));
    },
    async groupAvailabilities(groupId) {
      const members = membersOf(groupId);
      return ok(data.availabilities.filter((a) => members.includes(a.owner_id)));
    },
  };
}
