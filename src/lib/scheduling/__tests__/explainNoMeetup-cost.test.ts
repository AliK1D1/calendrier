/**
 * Revue « Pourquoi pas ? » 1 : un lieu où les premières personnes n'ont déjà plus de moment
 * commun assez long est abandonné tout de suite, sans calculer les trajets des suivantes.
 * Le résultat ne change pas (comparé à l'ancien code sur 400 horaires au hasard pendant la
 * revue : 95 « presque » trouvés, tous identiques).
 */
import { describe, expect, it } from "vitest";

import { explainNoMeetup } from "../explainNoMeetup";
import { zonedTime } from "../time";
import type { TravelTimeProvider } from "../travel";
import type { Person, Place } from "../types";

const DAY = "2026-11-10";
const place = (id: string, lng: number): Place => ({ id, name: id, lat: 45.5, lng });

function person(i: number, busyFrom: string, busyTo: string, at: Place): Person {
  const home = place(`maison-${i}`, -73.6 + i * 0.01);
  return {
    id: `p${i}`,
    name: `P${i}`,
    homePlaceId: home.id,
    travelMode: "walk",
    places: [home, at],
    busyBlocks: [
      {
        id: `b${i}`,
        start: zonedTime(DAY, busyFrom),
        end: zonedTime(DAY, busyTo),
        placeId: at.id,
        title: "Cours",
      },
    ],
  };
}

/** Trajets comptés : 10 min partout (0 pour un même lieu). */
function counting() {
  const calls: string[] = [];
  const provider: TravelTimeProvider = {
    async minutes(from, to) {
      calls.push(`${from.id}>${to.id}`);
      return from.id === to.id ? 0 : 10;
    },
  };
  return { provider, calls };
}

describe("revue « Pourquoi pas ? » 1 : coût borné", () => {
  it("les deux premières personnes n'ont aucun moment commun : on ne calcule pas les 8 autres", async () => {
    const cegep = place("cegep", -73.55);
    // P0 est occupé·e de 8 h à 15 h, P1 de 15 h à 22 h : aucun moment commun, nulle part.
    const people = [
      person(0, "08:00", "15:00", cegep),
      person(1, "15:00", "22:00", cegep),
      ...Array.from({ length: 8 }, (_, k) => person(k + 2, "12:00", "12:15", cegep)),
    ];
    const { provider, calls } = counting();
    const r = await explainNoMeetup(
      people,
      {
        personIds: people.map((p) => p.id),
        dates: { from: DAY, to: DAY },
        minDurationMinutes: 60,
        bufferMinutes: 5,
        candidatePlaceIds: ["cegep"],
      },
      provider,
    );
    expect(r).toEqual([]);
    // Seulement les trajets de P0 et P1 (avant : ceux des 10 personnes).
    expect(calls.every((c) => /maison-[01]>|>maison-[01]|cegep>cegep/.test(c))).toBe(true);
  });
});
