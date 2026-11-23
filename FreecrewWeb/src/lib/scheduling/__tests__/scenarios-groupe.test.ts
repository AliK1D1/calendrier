/**
 * Scénarios « Qui est disponible dans un groupe ? » (S29 à S41), sur les jeux de données de
 * `src/lib/testdata/freecrew.ts`, expliqués dans `docs/jeux-de-donnees.md` et dans le plan de
 * test `docs/plan-test-disponibilite-groupe.md`.
 *
 * Trois vues de la même question, du plus simple au plus réaliste :
 * 1. la grille (`availabilityGrid`) : qui est libre, tranche par tranche, SANS les trajets ;
 * 2. la recherche du groupe (`findMeetups`, `searchGroupMeetups`) : moments où tout le monde
 *    peut vraiment être au même endroit, trajets et marges compris ;
 * 3. « Je suis libre maintenant » (`searchFreeNow`) : qui, dans mes groupes, peut me voir
 *    dans les 2 prochaines heures.
 *
 * Les recherches passent par un magasin en mémoire (`datasetStore`) qui imite la RLS : on ne
 * lit que les groupes dont on est membre.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import { toPeople } from "@/lib/db/convert";
import { searchFreeNow } from "@/lib/meetups/freeNow";
import { searchGroupMeetups } from "@/lib/meetups/search";
import {
  DST_FALL_MONDAY,
  REFERENCE_MONDAY,
  addDays,
  dayOf,
  groupMembers,
  materialize,
  type DayKey,
  type Materialized,
} from "@/lib/testdata/freecrew";
import { datasetStore } from "@/lib/testdata/groupStore";

import { availabilityGrid } from "../availabilityGrid";
import { findMeetups } from "../findMeetups";
import { windowsFrom } from "../freeWindows";
import { TIME_ZONE, zonedTime } from "../time";
import { EstimatedTravelProvider } from "../travel";
import type { MeetupProposal, Person } from "../types";

// ─── Outils ────────────────────────────────────────────────────────────────────────────

const REF = materialize(REFERENCE_MONDAY);

/** Les personnes, telles que l'app les calcule, sur une plage de jours (défaut : la semaine). */
function peopleOf(data: Materialized = REF, range = data.week): Person[] {
  return toPeople(data.profiles, data.places, data.blocks, range, {
    availabilities: data.availabilities,
  }).people;
}

const PEOPLE = peopleOf();
const pick = (keys: string[], people: readonly Person[] = PEOPLE) =>
  keys.map((k) => {
    const p = people.find((x) => x.id === k);
    if (!p) throw new Error(`Personne absente : ${k}`);
    return p;
  });

const day = (d: DayKey, week = 0) => dayOf(REFERENCE_MONDAY, d, week);
const at = (d: DayKey, hhmm: string) => zonedTime(day(d), hhmm);
const clock = (i: Date) => formatInTimeZone(i, TIME_ZONE, "HH:mm");
const travel = () => new EstimatedTravelProvider();

const QUATRE = ["ali", "sam", "maya", "leo"];

/** Qui est libre à chaque tranche d'une journée : { « 08:00 »: [ids] }. */
function gridOf(keys: string[], d: string, people: readonly Person[] = PEOPLE) {
  const [g] = availabilityGrid(pick(keys, people), { from: d, to: d });
  return Object.fromEntries(g.slots.map((s) => [clock(s.start), s.freeIds]));
}

/** Tranches où tout le monde est libre. */
function allFree(keys: string[], d: string, people: readonly Person[] = PEOPLE): string[] {
  return Object.entries(gridOf(keys, d, people))
    .filter(([, ids]) => ids.length === keys.length)
    .map(([t]) => t);
}

/** Règle d'or : personne n'est à deux endroits (trajet et marge de 5 min compris). */
function expectRealistic(proposals: readonly MeetupProposal[], people: readonly Person[]) {
  for (const p of proposals) {
    for (const [id, leg] of Object.entries(p.travelByPerson)) {
      const who = pick([id], people)[0];
      const from = p.start.getTime() - (leg.to + (leg.to > 0 ? 5 : 0)) * 60_000;
      const to = p.end.getTime() + (leg.from + (leg.from > 0 ? 5 : 0)) * 60_000;
      for (const b of who.busyBlocks) {
        const overlaps = b.start.getTime() < to && b.end.getTime() > from;
        expect(overlaps, `${who.name} : « ${b.title} » chevauche ${clock(p.start)}`).toBe(false);
      }
    }
  }
}

/** La veille de la semaine des tests : « la semaine prochaine » = du 23 au 29 novembre. */
const SUNDAY_BEFORE = zonedTime(addDays(REFERENCE_MONDAY, -1), "12:00");

function searchGroup(viewer: string, group: string, participants = groupMembers(group), min = 60) {
  return searchGroupMeetups(
    datasetStore(REF, viewer),
    {
      groupId: group,
      participantIds: participants,
      period: "next-week",
      durationMinutes: min,
      bufferMinutes: 5,
    },
    { userId: viewer, now: SUNDAY_BEFORE, travel: travel() },
  );
}

function freeNow(viewer: string, now: Date, groupId: string | null = null) {
  return searchFreeNow(
    datasetStore(REF, viewer),
    { groupId },
    { userId: viewer, now, travel: travel() },
  );
}

// ─── Document ──────────────────────────────────────────────────────────────────────────

describe("scénarios du groupe : documentés", () => {
  it("chaque scénario de ce fichier est expliqué dans docs/jeux-de-donnees.md", () => {
    const doc = readFileSync(join(__dirname, "../../../../docs/jeux-de-donnees.md"), "utf8");
    const self = readFileSync(__filename, "utf8");
    const ids = [...new Set(self.match(/S\d{2}(?= ·)/g) ?? [])];
    expect(ids.length).toBeGreaterThanOrEqual(13);
    for (const id of ids) expect(doc, `${id} manque dans le document`).toContain(`${id} ·`);
  });
});

// ─── 1. La grille : qui est libre, tranche par tranche ─────────────────────────────────

describe("S29 · grille de « Les quatre » le lundi : qui est libre à chaque demi-heure", () => {
  const g = gridOf(QUATRE, day("lun"));

  it("28 tranches de 8 h à 22 h, dans l'ordre des membres", () => {
    expect(Object.keys(g)).toHaveLength(28);
    expect(Object.keys(g)[0]).toBe("08:00");
    expect(Object.keys(g).at(-1)).toBe("21:30");
  });

  it("le nombre de personnes libres change au fil des cours et du travail", () => {
    expect(g["08:30"]).toEqual(["leo"]); // ali, Sam et Maya en cours
    expect(g["10:00"]).toEqual(["ali", "leo"]);
    expect(g["11:00"]).toEqual(["ali", "sam", "leo"]); // Maya finit à 11 h 30
    expect(g["11:30"]).toEqual(QUATRE); // la seule demi-heure du jour où les quatre sont libres…
    expect(g["12:00"]).toEqual(["ali", "sam", "maya"]); // … Léo commence à 12 h
    expect(g["13:00"]).toEqual(["maya"]);
    expect(g["20:00"]).toEqual(QUATRE); // Léo finit à 20 h
  });

  it("une tranche coupée par un cours ne compte pas : libre = libre TOUTE la tranche", () => {
    // Maya finit à 11 h 30 : elle n'est pas libre de 11 h à 11 h 30.
    expect(g["11:00"]).not.toContain("maya");
  });
});

describe("S30 · la grille dit « tous libres », mais les trajets disent non", () => {
  it("lundi 11 h 30 à 12 h : les quatre sont libres sur la grille, mais pas au même endroit", async () => {
    expect(allFree(QUATRE, day("lun"))).toContain("11:30");
    const proposals = await findMeetups(
      PEOPLE,
      {
        personIds: QUATRE,
        dates: { from: day("lun"), to: day("lun") },
        minDurationMinutes: 30,
        bufferMinutes: 5,
      },
      travel(),
    );
    // Maya est à l'UdeM, ali et Sam au cégep (Longueuil), Léo travaille à Laval à 12 h :
    // aucune rencontre en personne, seulement des appels sur les trous communs de la grille.
    expect(proposals.filter((p) => p.kind === "in-person")).toEqual([]);
    expect(proposals.map((p) => [p.kind, clock(p.start), clock(p.end)])).toEqual(
      expect.arrayContaining([
        ["call", "11:30", "12:00"],
        ["call", "20:00", "22:00"],
      ]),
    );
  });
});

describe("S31 · tout le monde est libre", () => {
  it("Hugo et Nora le mercredi : les 28 tranches ont les deux", () => {
    expect(allFree(["nora", "hugo"], day("mer"))).toHaveLength(28);
  });

  it("« Les quatre » dimanche : tous libres de 8 h à 11 h et de 17 h à 22 h (Léo travaille entre)", async () => {
    const free = allFree(QUATRE, day("dim"));
    expect(free).toContain("08:00");
    expect(free).toContain("10:30");
    expect(free).not.toContain("11:00");
    expect(free).not.toContain("16:30");
    expect(free).toContain("17:00");
    expect(free).toHaveLength(6 + 10);

    const proposals = await findMeetups(
      PEOPLE,
      {
        personIds: QUATRE,
        dates: { from: day("dim"), to: day("dim") },
        minDurationMinutes: 60,
        bufferMinutes: 5,
      },
      travel(),
    );
    const inPerson = proposals.filter((p) => p.kind === "in-person");
    expect(inPerson.length).toBeGreaterThan(0);
    // Le soir : Léo arrive de Laval après le travail (17 h + trajet), jamais avant 17 h.
    for (const p of inPerson)
      expect(p.start.getTime()).toBeGreaterThan(at("dim", "17:00").getTime());
    expectRealistic(inPerson, PEOPLE);
  });
});

describe("S32 · personne n'est libre", () => {
  it("ali, Sam et Maya lundi de 9 h à 10 h : aucune personne libre dans la tranche", () => {
    const g = gridOf(["ali", "sam", "maya"], day("lun"));
    expect(g["09:00"]).toEqual([]);
    expect(g["09:30"]).toEqual([]);
  });

  it("« Les quatre » vendredi : jamais les quatre en même temps, donc aucune proposition", async () => {
    expect(allFree(QUATRE, day("ven"))).toEqual([]);
    const proposals = await findMeetups(
      PEOPLE,
      {
        personIds: QUATRE,
        dates: { from: day("ven"), to: day("ven") },
        minDurationMinutes: 30,
        bufferMinutes: 5,
      },
      travel(),
    );
    expect(proposals).toEqual([]); // pas même un appel
  });
});

describe("S33 · seulement une partie du groupe, et membres étrangers refusés", () => {
  it("ali choisit ali, Sam et Maya dans « Les quatre » : Léo n'apparaît nulle part", async () => {
    const r = await searchGroup("ali", "quatre", ["ali", "sam", "maya"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.participants.map((p) => p.id)).toEqual(["ali", "sam", "maya"]);
    const names = new Set(r.value.grid.flatMap((d) => d.slots.flatMap((s) => s.free)));
    expect(names).toEqual(new Set(["ali", "Sam", "Maya"]));
  });

  it("un participant qui n'est pas du groupe : erreur claire", async () => {
    const r = await searchGroup("ali", "quatre", ["ali", "nora"]);
    expect(r).toEqual({ ok: false, error: "Un des participants ne fait pas partie du groupe." });
  });

  it("Nora regarde « Les quatre » (pas membre) : « Groupe introuvable. », rien d'autre", async () => {
    expect(await searchGroup("nora", "quatre")).toEqual({
      ok: false,
      error: "Groupe introuvable.",
    });
  });
});

describe("S34 · heures calmes et limite de sorties, aussi dans la grille", () => {
  it("samedi : Jade n'est pas libre avant 10 h ni après 20 h", () => {
    const g = gridOf(["nora", "jade"], day("sam"));
    expect(g["09:30"]).toEqual(["nora"]);
    expect(g["10:00"]).toEqual(["nora", "jade"]);
    expect(g["19:30"]).toEqual(["nora", "jade"]);
    expect(g["20:00"]).toEqual(["nora"]);
  });

  it("dimanche : Jade a déjà sa sortie (la marche) ; elle n'est libre dans aucune tranche", () => {
    const g = gridOf(["nora", "jade"], day("dim"));
    expect(Object.values(g).some((ids) => ids.includes("jade"))).toBe(false);
    // Pendant la marche (14 h à 16 h), Nora y est aussi : personne de libre.
    expect(g["14:00"]).toEqual([]);
    expect(g["16:00"]).toEqual(["nora"]);
  });
});

describe("S35 · récurrence et disponibilité ponctuelle, dans la grille", () => {
  it("samedi : Lina travaille, mais s'est rendue disponible de 13 h à 16 h", () => {
    const g = gridOf(["nora", "lina"], day("sam"));
    expect(g["12:30"]).toEqual(["nora"]);
    expect(g["13:00"]).toEqual(["nora", "lina"]);
    expect(g["15:30"]).toEqual(["nora", "lina"]);
    expect(g["16:00"]).toEqual(["nora"]);
  });

  it("jeudi : club d'échecs une semaine sur deux (occupée cette semaine, libre la suivante)", () => {
    const twoWeeks = { from: day("lun"), to: day("dim", 1) };
    const people = peopleOf(REF, twoWeeks);
    expect(gridOf(["nora", "lina"], day("jeu"), people)["18:00"]).toEqual(["nora"]);
    expect(gridOf(["nora", "lina"], day("jeu", 1), people)["18:00"]).toEqual(["nora", "lina"]);
  });
});

describe("S36 · un membre sans maison dans le groupe", () => {
  it("« Avec Zoé » : Zoé est écartée avec la raison ; seul ali reste, donc ni grille ni proposition", async () => {
    const r = await searchGroup("ali", "zoe");
    if (!r.ok) throw new Error(r.error);
    expect(r.value.excluded).toEqual([
      { id: "zoe", name: "Zoé", reason: "n'a pas encore choisi son lieu « maison »" },
    ]);
    expect(r.value.participants.map((p) => p.id)).toEqual(["ali"]);
    expect(r.value.grid).toEqual([]);
    expect(r.value.inPerson).toEqual([]);
    expect(r.value.calls).toEqual([]);
  });
});

// ─── 3. « Je suis libre maintenant » ───────────────────────────────────────────────────

describe("S37 · « libre maintenant » ne fait jamais partir quelqu'un dans le passé", () => {
  it("lundi 11 h 05 : Nora arrive au cégep à 11 h 29 (départ 11 h 15, 9 min + 5 min de marge)", async () => {
    const r = await freeNow("ali", at("lun", "11:05"));
    if (!r.ok) throw new Error(r.error);
    const nora = r.value.matches.find((m) => m.name === "Nora");
    expect(nora).toMatchObject({ kind: "in-person", timeLabel: "11 h 29 – 13 h", theirTravel: 9 });
    // Sam est déjà au cégep : dès 11 h 15, sans trajet.
    expect(r.value.matches[0]).toMatchObject({
      name: "Sam",
      kind: "in-person",
      timeLabel: "11 h 15 – 13 h",
      myTravel: 0,
      theirTravel: 0,
    });
  });

  it.each([
    ["lun", "11:05"],
    ["mer", "10:15"],
    ["sam", "14:00"],
    ["dim", "07:00"],
  ] as const)(
    "%s %s : chaque rencontre commence après le départ (maintenant) + trajet + marge",
    async (d, t) => {
      const now = at(d, t);
      const notBefore = Math.ceil(now.getTime() / 900_000) * 900_000; // quart d'heure suivant
      const r = await freeNow("ali", now);
      if (!r.ok) throw new Error(r.error);
      for (const m of r.value.matches.filter((x) => x.kind === "in-person")) {
        const longest = Math.max(m.myTravel, m.theirTravel);
        const earliest =
          Math.max(notBefore, now.getTime()) + (longest > 0 ? longest + 5 : 0) * 60_000;
        expect(new Date(m.start).getTime(), `${m.name} ${m.timeLabel}`).toBeGreaterThanOrEqual(
          earliest,
        );
      }
    },
  );

  it("une fenêtre commencée avant « maintenant » part de maintenant ; une fenêtre finie disparaît", () => {
    const w = { placeBeforeId: "a", placeAfterId: "b" };
    const windows = [
      { ...w, start: at("lun", "08:00"), end: at("lun", "09:00") },
      { ...w, start: at("lun", "10:00"), end: at("lun", "13:00") },
      { ...w, start: at("lun", "14:00"), end: at("lun", "15:00") },
    ];
    const from = windowsFrom(windows, at("lun", "11:15"));
    expect(from.map((x) => [clock(x.start), clock(x.end)])).toEqual([
      ["11:15", "13:00"],
      ["14:00", "15:00"],
    ]);
    expect(windowsFrom(windows, undefined)).toEqual(windows);
  });
});

describe("S38 · « libre maintenant » dans tous mes groupes (Toute la bande)", () => {
  it("lundi 11 h 05 : 8 personnes essayées, Zoé nommée à part, Félix en appel seulement", async () => {
    const r = await freeNow("ali", at("lun", "11:05"));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.checked).toBe(8);
    expect(r.value.incomplete).toEqual(["Zoé"]);
    expect(r.value.truncated).toBe(false);
    expect(r.value.windowLabel).toBe("11 h 05 – 13 h 05");
    expect(r.value.matches.find((m) => m.name === "Félix")?.kind).toBe("call");
    // Groupes en commun listés pour chaque personne.
    expect(r.value.matches.find((m) => m.name === "Sam")?.groups).toEqual([
      "Pauses du cégep",
      "Les quatre",
      "Toute la bande",
    ]);
    // Du plus tôt au plus tard.
    const starts = r.value.matches.map((m) => m.start);
    expect(starts).toEqual([...starts].sort());
  });

  it("Nora dimanche midi : Jade n'est pas proposée (elle a déjà sa sortie du jour)", async () => {
    const r = await freeNow("nora", at("dim", "12:00"));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.matches.map((m) => m.name)).not.toContain("Jade");
    expect(r.value.matches.map((m) => m.name)).toContain("Sam");
  });

  it("vendredi 21 h 30 : la journée finit à 22 h, trop court pour se déplacer : seulement des appels", async () => {
    const r = await freeNow("ali", at("ven", "21:30"));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.matches.length).toBeGreaterThan(0);
    for (const m of r.value.matches)
      expect([m.kind, m.timeLabel]).toEqual(["call", "21 h 30 – 22 h"]);
    // Léo travaille jusqu'à 22 h : il n'y est pas.
    expect(r.value.matches.map((m) => m.name)).not.toContain("Léo");
  });
});

describe("S39 · « libre maintenant » : un seul groupe, et les refus", () => {
  it("seulement « Pauses du cégep » : Sam, et personne d'autre", async () => {
    const r = await freeNow("ali", at("lun", "11:05"), "cegep");
    expect(r.ok && r.value.matches.map((m) => m.name)).toEqual(["Sam"]);
  });

  it("un groupe dont ali n'est pas membre (« Jade et Nora ») : refusé sans rien révéler", async () => {
    expect(await freeNow("ali", at("lun", "11:05"), "calmes")).toEqual({
      ok: false,
      error: "Groupe introuvable.",
    });
  });

  it("Zoé (sans maison) demande qui est libre : on lui dit de choisir sa maison", async () => {
    const r = await freeNow("zoe", at("lun", "11:05"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/maison/);
  });

  it("lundi 22 h 30 : tout le monde est hors des heures de la journée, liste vide", async () => {
    const r = await freeNow("ali", at("lun", "22:30"));
    expect(r.ok && r.value.matches).toEqual([]);
  });
});

// ─── Grand groupe et fuseau ────────────────────────────────────────────────────────────

describe("S40 · « Toute la bande » sur la semaine (10 personnes)", () => {
  it("Zoé écartée, 9 participants ; Félix (Sherbrooke, à pied) empêche toute rencontre en personne", async () => {
    const r = await searchGroup("ali", "bande");
    if (!r.ok) throw new Error(r.error);
    expect(r.value.excluded.map((e) => e.name)).toEqual(["Zoé"]);
    expect(r.value.participants).toHaveLength(9);
    expect(r.value.inPerson).toEqual([]);
    expect(r.value.calls.length).toBeGreaterThan(0);
    expect(r.value.grid).toHaveLength(7);
    for (const d of r.value.grid) expect(d.slots).toHaveLength(28);
    expect(r.value.computeMs).toBeLessThan(2000);
  });

  it("sans Félix ni Zoé : des rencontres en personne, toutes réalistes pour les 8", async () => {
    const eight = ["ali", "sam", "maya", "leo", "nora", "jade", "hugo", "lina"];
    const r = await searchGroup("ali", "bande", eight);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.inPerson.length).toBeGreaterThan(0);
    for (const v of r.value.inPerson) expect(v.travel).toHaveLength(8);

    const proposals = await findMeetups(
      PEOPLE,
      {
        personIds: eight,
        dates: REF.week,
        minDurationMinutes: 60,
        bufferMinutes: 5,
      },
      travel(),
    );
    expectRealistic(
      proposals.filter((p) => p.kind === "in-person"),
      PEOPLE,
    );
  });
});

describe("S41 · grille du groupe au changement d'heure", () => {
  it("dimanche 1er novembre (25 h) : toujours 28 tranches de 8 h à 22 h, Léo occupé de 11 h à 17 h", () => {
    const dst = materialize(DST_FALL_MONDAY);
    const people = peopleOf(dst);
    const g = gridOf(["ali", "leo"], dayOf(DST_FALL_MONDAY, "dim"), people);
    expect(Object.keys(g)).toHaveLength(28);
    expect(Object.keys(g)[0]).toBe("08:00");
    expect(g["10:30"]).toEqual(["ali", "leo"]);
    expect(g["11:00"]).toEqual(["ali"]);
    expect(g["16:30"]).toEqual(["ali"]);
    expect(g["17:00"]).toEqual(["ali", "leo"]);
  });
});
