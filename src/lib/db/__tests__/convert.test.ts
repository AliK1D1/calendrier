import { describe, expect, it } from "vitest";

import { findMeetups } from "@/lib/scheduling/findMeetups";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import { validateBlockForm } from "@/lib/scheduling/weeklyBlocks";

import {
  type BusyBlockInput,
  expandBusyBlock,
  expandBusyBlocks,
  fromBlockSpec,
  type PlaceInput,
  type ProfileInput,
  toBlockSpec,
  toHHmm,
  toPeople,
} from "../convert";

const ALI = "ali";
const SAM = "sam";

const places: PlaceInput[] = [
  { id: "maison-ali", owner_id: ALI, name: "Maison d'Ali", lat: 45.5017, lng: -73.4842 },
  { id: "cegep-ali", owner_id: ALI, name: "Cégep Édouard-Montpetit", lat: 45.5312, lng: -73.5034 },
  { id: "maison-sam", owner_id: SAM, name: "Maison de Sam", lat: 45.5089, lng: -73.4914 },
  { id: "cegep-sam", owner_id: SAM, name: "Cégep Édouard-Montpetit", lat: 45.5312, lng: -73.5034 },
];

function block(partial: Partial<BusyBlockInput>): BusyBlockInput {
  return {
    id: "b1",
    owner_id: ALI,
    title: "Chimie",
    place_id: "cegep-ali",
    start_time: "10:00:00",
    end_time: "12:00:00",
    weekday: 1,
    valid_from: null,
    valid_until: null,
    ...partial,
  };
}

const iso = (d: Date) => d.toISOString();

describe("toHHmm", () => {
  it("accepte les formats Postgres et refuse le reste", () => {
    expect(toHHmm("10:00:00")).toBe("10:00");
    expect(toHHmm("24:00:00")).toBe("24:00");
    expect(toHHmm("08:15")).toBe("08:15");
    expect(toHHmm("08:15:00.000")).toBe("08:15");
    expect(() => toHHmm("8h")).toThrow(/Heure invalide/);
  });
});

describe("expandBusyBlock", () => {
  it("déplie un bloc hebdomadaire sur chaque lundi de la plage", () => {
    const out = expandBusyBlock(block({}), { from: "2025-09-15", to: "2025-09-30" }, "maison-ali");
    expect(out.map((b) => b.id)).toEqual(["b1@2025-09-15", "b1@2025-09-22", "b1@2025-09-29"]);
    expect(iso(out[0].start)).toBe("2025-09-15T14:00:00.000Z"); // 10 h HAE
    expect(iso(out[0].end)).toBe("2025-09-15T16:00:00.000Z");
    expect(out[0]).toMatchObject({ placeId: "cegep-ali", title: "Chimie" });
  });

  it("respecte la période de validité (session), bornes incluses", () => {
    const out = expandBusyBlock(
      block({ valid_from: "2025-09-22", valid_until: "2025-10-06" }),
      { from: "2025-09-01", to: "2025-12-31" },
      "maison-ali",
    );
    expect(out.map((b) => b.id)).toEqual(["b1@2025-09-22", "b1@2025-09-29", "b1@2025-10-06"]);
  });

  it("ne déplie rien hors de la période de validité", () => {
    expect(
      expandBusyBlock(
        block({ valid_from: "2026-01-19", valid_until: "2026-05-15" }),
        { from: "2025-09-15", to: "2025-09-21" },
        "maison-ali",
      ),
    ).toEqual([]);
  });

  it("garde la même heure locale avant et après le changement d'heure de novembre", () => {
    // Lundi 27 octobre 2025 (HAE, UTC−4) puis lundi 3 novembre 2025 (HNE, UTC−5).
    const out = expandBusyBlock(block({}), { from: "2025-10-27", to: "2025-11-03" }, "maison-ali");
    expect(out.map((b) => iso(b.start))).toEqual([
      "2025-10-27T14:00:00.000Z",
      "2025-11-03T15:00:00.000Z",
    ]);
    expect(out.every((b) => b.end.getTime() - b.start.getTime() === 2 * 3_600_000)).toBe(true);
  });

  it("gère un bloc le jour même du changement d'heure (dimanche)", () => {
    // Dimanche 8 mars 2026 : la nuit ne dure que 23 h. Bloc 1 h → 4 h = 2 h réelles.
    const nuit = block({ weekday: 7, start_time: "01:00:00", end_time: "04:00:00" });
    const [mars] = expandBusyBlock(nuit, { from: "2026-03-08", to: "2026-03-08" }, "m");
    expect(iso(mars.start)).toBe("2026-03-08T06:00:00.000Z");
    expect(iso(mars.end)).toBe("2026-03-08T08:00:00.000Z");
    // Dimanche 1er novembre 2026 : 25 h. Même bloc = 4 h réelles.
    const [nov] = expandBusyBlock(nuit, { from: "2026-11-01", to: "2026-11-01" }, "m");
    expect(nov.end.getTime() - nov.start.getTime()).toBe(4 * 3_600_000);
  });

  it("un bloc qui commence dans l'heure sautée commence à 3 h HAE", () => {
    const b = block({ weekday: 7, start_time: "02:30:00", end_time: "05:00:00" });
    const [out] = expandBusyBlock(b, { from: "2026-03-08", to: "2026-03-08" }, "m");
    expect(iso(out.start)).toBe("2026-03-08T07:30:00.000Z"); // 3 h 30 HAE
    expect(iso(out.end)).toBe("2026-03-08T09:00:00.000Z"); // 5 h HAE
  });

  it("ignore un bloc entièrement dans l'heure sautée (durée nulle)", () => {
    const b = block({ weekday: 7, start_time: "02:00:00", end_time: "03:00:00" });
    expect(expandBusyBlock(b, { from: "2026-03-08", to: "2026-03-08" }, "m")).toEqual([]);
  });

  it("« 24:00 » finit à minuit le lendemain", () => {
    const b = block({ weekday: 5, start_time: "22:00:00", end_time: "24:00:00" });
    const [out] = expandBusyBlock(b, { from: "2025-12-19", to: "2025-12-19" }, "m");
    expect(iso(out.end)).toBe("2025-12-20T05:00:00.000Z");
  });

  it("bloc ponctuel : seulement son jour, s'il est dans la plage", () => {
    const b = block({ id: "exam", weekday: null, valid_from: "2025-09-17", valid_until: null });
    const out = expandBusyBlock(b, { from: "2025-09-15", to: "2025-09-21" }, "m");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("exam");
    expect(iso(out[0].start)).toBe("2025-09-17T14:00:00.000Z");
    expect(expandBusyBlock(b, { from: "2025-09-18", to: "2025-09-21" }, "m")).toEqual([]);
  });

  it("lieu supprimé (place_id nul) : la maison", () => {
    const [out] = expandBusyBlock(
      block({ place_id: null }),
      { from: "2025-09-15", to: "2025-09-15" },
      "maison-ali",
    );
    expect(out.placeId).toBe("maison-ali");
  });

  it("expandBusyBlocks trie les blocs par début", () => {
    const out = expandBusyBlocks(
      [
        block({ id: "mardi", weekday: 2 }),
        block({ id: "lundi-pm", start_time: "13:00:00", end_time: "15:00:00" }),
        block({ id: "lundi-am" }),
      ],
      { from: "2025-09-15", to: "2025-09-16" },
      "m",
    );
    expect(out.map((b) => b.id)).toEqual([
      "lundi-am@2025-09-15",
      "lundi-pm@2025-09-15",
      "mardi@2025-09-16",
    ]);
  });
});

describe("toPeople", () => {
  const profiles: ProfileInput[] = [
    { id: ALI, display_name: "Ali", travel_mode: "transit", home_place_id: "maison-ali" },
    { id: SAM, display_name: "Sam", travel_mode: "walk", home_place_id: "maison-sam" },
    { id: "zoe", display_name: "Zoé", travel_mode: "car", home_place_id: null },
  ];

  it("rattache lieux et blocs à leur propriétaire et écarte les profils sans maison", () => {
    const { people, incomplete } = toPeople(
      profiles,
      places,
      [block({}), block({ id: "b2", owner_id: SAM, place_id: "cegep-sam", weekday: 2 })],
      { from: "2025-09-15", to: "2025-09-21" },
    );
    expect(people.map((p) => p.id)).toEqual([ALI, SAM]);
    expect(people[0]).toMatchObject({
      name: "Ali",
      homePlaceId: "maison-ali",
      travelMode: "transit",
    });
    expect(people[0].places.map((p) => p.id)).toEqual(["maison-ali", "cegep-ali"]);
    expect(people[0].busyBlocks.map((b) => b.id)).toEqual(["b1@2025-09-15"]);
    expect(people[1].busyBlocks.map((b) => b.id)).toEqual(["b2@2025-09-16"]);
    expect(incomplete).toEqual([{ id: "zoe", name: "Zoé", reason: "no-home" }]);
  });

  it("un bloc dont le lieu est inconnu tombe à la maison", () => {
    const { people } = toPeople([profiles[0]], places, [block({ place_id: "lieu-disparu" })], {
      from: "2025-09-15",
      to: "2025-09-15",
    });
    expect(people[0].busyBlocks[0].placeId).toBe("maison-ali");
  });

  it("donne des personnes directement utilisables par findMeetups", async () => {
    // Ali et Sam au même cégep le lundi, cours jusqu'à 12 h puis à partir de 13 h.
    const rows: BusyBlockInput[] = [ALI, SAM].flatMap((owner) => [
      block({ id: `${owner}-am`, owner_id: owner, place_id: `cegep-${owner}` }),
      block({
        id: `${owner}-pm`,
        owner_id: owner,
        place_id: `cegep-${owner}`,
        start_time: "13:00:00",
        end_time: "15:00:00",
      }),
    ]);
    const { people } = toPeople(profiles.slice(0, 2), places, rows, {
      from: "2025-09-15",
      to: "2025-09-15",
    });
    const proposals = await findMeetups(
      people,
      {
        personIds: [ALI, SAM],
        dates: { from: "2025-09-15", to: "2025-09-15" },
        minDurationMinutes: 45,
        bufferMinutes: 5,
        dayHours: { start: "10:00", end: "15:00" },
      },
      new EstimatedTravelProvider(),
    );
    expect(proposals.length).toBeGreaterThan(0);
    const midi = proposals.find((p) => iso(p.start) === "2025-09-15T16:00:00.000Z");
    expect(midi).toBeDefined();
    expect(midi?.kind).toBe("in-person");
    expect(iso(midi!.end)).toBe("2025-09-15T17:00:00.000Z");
  });
});

describe("horaire saisi (/horaire) ↔ busy_blocks", () => {
  it("toBlockSpec et fromBlockSpec font l'aller-retour (heures locales en minutes)", () => {
    const row = block({ start_time: "10:15:00", end_time: "24:00:00", weekday: 3 });
    const spec = toBlockSpec(row);
    expect(spec).toMatchObject({ id: "b1", startMinute: 615, endMinute: 1440, weekday: 3 });
    expect(fromBlockSpec(spec)).toEqual({
      title: "Chimie",
      place_id: "cegep-ali",
      start_time: "10:15",
      end_time: "24:00",
      weekday: 3,
      valid_from: null,
      valid_until: null,
    });
  });

  it("refuse un jour de semaine hors 1..7 venant de la BD", () => {
    expect(() => toBlockSpec(block({ weekday: 8 }))).toThrow(/Jour de semaine/);
  });

  it("un cours saisi le dimanche à 10 h reste à 10 h avant et après le changement d'heure, et s'arrête avec la session", () => {
    const r = validateBlockForm({
      title: "Job",
      placeId: null,
      start: "10:00",
      end: "14:00",
      kind: "weekly",
      weekdays: [7],
      date: "",
      sessionStart: "2025-10-20",
      sessionEnd: "2025-11-09",
    });
    if (!r.ok) throw new Error(r.error);
    const row: BusyBlockInput = { id: "job", owner_id: ALI, ...fromBlockSpec(r.value[0]) };
    const blocs = expandBusyBlocks([row], { from: "2025-10-01", to: "2025-12-31" }, "maison-ali");
    expect(blocs.map((b) => [b.id, iso(b.start), iso(b.end)])).toEqual([
      ["job@2025-10-26", "2025-10-26T14:00:00.000Z", "2025-10-26T18:00:00.000Z"], // HAE
      ["job@2025-11-02", "2025-11-02T15:00:00.000Z", "2025-11-02T19:00:00.000Z"], // HNE, le jour même
      ["job@2025-11-09", "2025-11-09T15:00:00.000Z", "2025-11-09T19:00:00.000Z"],
    ]);
    expect(blocs.every((b) => b.placeId === "maison-ali")).toBe(true);
  });

  it("toPeople ajoute les heures où je ne sors pas comme blocs à la maison", () => {
    const { people } = toPeople(
      [
        {
          id: ALI,
          display_name: "Ali",
          travel_mode: "transit",
          home_place_id: "maison-ali",
          unavailable_before: "09:00:00",
          unavailable_after: "22:00:00",
        },
      ],
      places,
      [block({})],
      { from: "2025-09-15", to: "2025-09-15" },
    );
    expect(people[0].busyBlocks.map((b) => [b.id, b.placeId])).toEqual([
      ["calme-avant@2025-09-15", "maison-ali"],
      ["b1@2025-09-15", "cegep-ali"],
      ["calme-apres@2025-09-15", "maison-ali"],
    ]);
  });
});
