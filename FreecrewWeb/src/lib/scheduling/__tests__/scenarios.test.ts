/**
 * Scénarios des jeux de données (`src/lib/testdata/freecrew.ts`), expliqués un par un dans
 * `docs/jeux-de-donnees.md`. Chaque `describe` porte l'identifiant du scénario (S01, S02…).
 *
 * Les données passent par le même chemin que dans l'app : lignes de la BD → `toPeople`
 * (heures « je ne sors pas », disponibilités, limite de sorties, lieu supprimé) → logique pure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import { expandBusyBlocks, toPeople, type BusyBlockInput } from "@/lib/db/convert";
import { createNominatimGeocoder } from "@/lib/geocoding/geocoder";
import { parseIcs } from "@/lib/import/ics";
import { validatePropose, validateRepeat } from "@/lib/plans/validation";
import {
  DAYS,
  DST_FALL_MONDAY,
  DST_SPRING_MONDAY,
  GROUPS,
  P,
  PEOPLE,
  PLANS,
  REFERENCE_MONDAY,
  dayOf,
  groupMembers,
  materialize,
  nextMonday,
  type DayKey,
  type Materialized,
} from "@/lib/testdata/freecrew";
import { FallbackTravelProvider } from "@/lib/travel/fallback";
import type { TravelMatrixSource } from "@/lib/travel/matrix";

import { explainNoMeetup } from "../explainNoMeetup";
import { findMeetups } from "../findMeetups";
import { findMeetupSoon } from "../freeNow";
import { getFreeWindows, mergeBusyBlocks } from "../freeWindows";
import { planConflicts } from "../planConflicts";
import { DEFAULT_STUDY_PREFERENCES, planStudySessions } from "../studyPlanner";
import { TIME_ZONE, minutesBetween, zonedDayBounds, zonedTime } from "../time";
import { EstimatedTravelProvider, estimateTravelMinutes } from "../travel";
import type { DayHours, MeetupProposal, MeetupRequest, Person } from "../types";
import { findOverlaps, validateBlockForm } from "../weeklyBlocks";

// ─── Outils ────────────────────────────────────────────────────────────────────────────

const REF = materialize(REFERENCE_MONDAY);

/** Les personnes de la semaine, telles que l'app les calcule (`toPeople`). */
function peopleOf(data: Materialized = REF, options: { late?: boolean } = {}) {
  const blocks = options.late ? [...data.blocks, ...data.lateBlocks] : data.blocks;
  return toPeople(data.profiles, data.places, blocks, data.week, {
    availabilities: data.availabilities,
  });
}

const PEOPLE_REF = peopleOf().people;

function person(key: string, people: readonly Person[] = PEOPLE_REF): Person {
  const p = people.find((x) => x.id === key);
  if (!p) throw new Error(`Personne absente : ${key}`);
  return p;
}

const day = (d: DayKey, monday = REFERENCE_MONDAY) => dayOf(monday, d);
const at = (d: DayKey, hhmm: string, monday = REFERENCE_MONDAY) =>
  zonedTime(dayOf(monday, d), hhmm);
const clock = (instant: Date) => formatInTimeZone(instant, TIME_ZONE, "HH:mm");
const localDay = (instant: Date) => formatInTimeZone(instant, TIME_ZONE, "yyyy-MM-dd");

function request(
  personIds: string[],
  d: DayKey,
  minDurationMinutes: number,
  extra: Partial<MeetupRequest> & { dayHours?: DayHours } = {},
): MeetupRequest {
  return {
    personIds,
    dates: { from: day(d), to: day(d) },
    minDurationMinutes,
    bufferMinutes: 5,
    ...extra,
  };
}

const travel = () => new EstimatedTravelProvider();

/**
 * Règle d'or : une proposition ne demande jamais à quelqu'un d'être à deux endroits. Pour
 * chaque personne, [début − trajet aller − marge, fin + trajet retour + marge] ne touche
 * aucun de ses blocs occupés (la marge ne compte que s'il y a un trajet).
 */
function expectRealistic(
  proposals: readonly MeetupProposal[],
  people: readonly Person[],
  buffer = 5,
) {
  for (const p of proposals) {
    expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
    for (const [id, leg] of Object.entries(p.travelByPerson)) {
      const who = person(id, people);
      const from = p.start.getTime() - (leg.to + (leg.to > 0 ? buffer : 0)) * 60_000;
      const to = p.end.getTime() + (leg.from + (leg.from > 0 ? buffer : 0)) * 60_000;
      for (const b of who.busyBlocks) {
        const overlaps = b.start.getTime() < to && b.end.getTime() > from;
        expect(overlaps, `${who.name} : « ${b.title} » chevauche ${clock(p.start)}`).toBe(false);
      }
    }
  }
}

// ─── Cohérence des données ─────────────────────────────────────────────────────────────

describe("jeux de données : cohérence", () => {
  it("chaque personne a un nom d'utilisateur valide et unique", () => {
    const names = PEOPLE.map((p) => p.username);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9][a-z0-9_.]{2,19}$/);
  });

  it("les lieux ont des coordonnées valides et des clés uniques", () => {
    const keys = Object.values(P).map((p) => p.id);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of Object.values(P)) {
      expect(() => estimateTravelMinutes(p, P.aliHome, "car")).not.toThrow();
    }
  });

  it("les groupes et les plans ne citent que des personnes connues", () => {
    const keys = new Set(PEOPLE.map((p) => p.key));
    for (const g of GROUPS) for (const m of groupMembers(g.key)) expect(keys.has(m)).toBe(true);
    for (const plan of PLANS) {
      const members = groupMembers(plan.group);
      for (const k of [plan.proposer, ...plan.accepted, ...plan.declined]) {
        expect(members).toContain(k);
      }
    }
  });

  it("la semaine de référence va du lundi au dimanche", () => {
    expect(REF.week).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(DAYS.map((d) => day(d))).toHaveLength(7);
    expect(nextMonday("2026-11-20")).toBe("2026-11-23");
    expect(nextMonday("2026-11-23")).toBe("2026-11-23");
  });

  it("chaque scénario testé ici est expliqué dans le document", () => {
    const doc = readFileSync(join(__dirname, "../../../../docs/jeux-de-donnees.md"), "utf8");
    const self = readFileSync(__filename, "utf8");
    const ids = [...new Set(self.match(/S\d{2}(?= ·)/g) ?? [])];
    expect(ids.length).toBeGreaterThanOrEqual(25);
    for (const id of ids) expect(doc, `${id} manque dans le document`).toContain(`${id} ·`);
  });
});

// ─── Rencontres ────────────────────────────────────────────────────────────────────────

describe("S01 · ali et Sam se voient au cégep entre deux cours (réussite)", () => {
  it("propose le cégep de 11 h à 13 h le lundi, sans trajet", async () => {
    const people = PEOPLE_REF;
    const proposals = await findMeetups(people, request(["ali", "sam"], "lun", 60), travel());
    const cegep = proposals.find(
      (p) => p.kind === "in-person" && clock(p.start) === "11:00" && clock(p.end) === "13:00",
    );
    expect(cegep).toBeDefined();
    expect([P.aliCegep.id, P.samCegep.id]).toContain(cegep?.placeId);
    expect(cegep?.travelByPerson).toEqual({ ali: { to: 0, from: 0 }, sam: { to: 0, from: 0 } });
    expectRealistic(proposals, people);
  });
});

describe("S02 · ali et Léo n'ont aucun moment commun le vendredi (aucun résultat)", () => {
  it("ne propose rien, ni rencontre ni appel, et n'a rien à expliquer", async () => {
    const req = request(["ali", "leo"], "ven", 30);
    expect(await findMeetups(PEOPLE_REF, req, travel())).toEqual([]);
    expect(await explainNoMeetup(PEOPLE_REF, req, travel())).toEqual([]);
  });
});

describe("S03 · ali et Maya : le trajet mange le temps libre du mercredi matin (presque)", () => {
  // Les deux sont libres de 10 h à 13 h, mais ali est au cégep (Longueuil) et Maya à l'UdeM.
  const req = request(["ali", "maya"], "mer", 120, {
    dayHours: { start: "08:00", end: "13:00" },
  });

  it("2 h en personne : impossible, Freecrew propose un appel de 10 h à 13 h", async () => {
    const proposals = await findMeetups(PEOPLE_REF, req, travel());
    expect(proposals.map((p) => [p.kind, clock(p.start), clock(p.end)])).toEqual([
      ["call", "10:00", "13:00"],
    ]);
  });

  it("explique : 1 h 33 possible chez Maya, ali limitée par son trajet", async () => {
    const [best] = await explainNoMeetup(PEOPLE_REF, req, travel());
    expect(best.placeId).toBe(P.mayaHome.id);
    expect([clock(best.start), clock(best.end)]).toEqual(["10:46", "12:19"]);
    expect(best.sharedMinutes).toBe(93);
    expect(best.missingMinutes).toBe(27);
    expect(best.limiting?.personId).toBe("ali");
    expect(best.limiting?.causes.every((c) => c.reason === "travel")).toBe(true);
    expect(best.compromises[0]).toEqual({ kind: "shorten", durationMinutes: 90 });
  });

  it("avec 90 min, la rencontre chez Maya devient possible (trajets comptés)", async () => {
    const proposals = await findMeetups(PEOPLE_REF, { ...req, minDurationMinutes: 90 }, travel());
    expect(proposals[0]).toMatchObject({ kind: "in-person", placeId: P.mayaHome.id });
    expect(proposals[0].travelByPerson).toEqual({
      ali: { to: 41, from: 36 },
      maya: { to: 24, from: 0 },
    });
    expectRealistic(proposals, PEOPLE_REF);
  });
});

describe("S04 · Félix habite à Sherbrooke et marche : trajet trop long (appel seulement)", () => {
  it("le samedi, propose seulement un appel, toute la journée", async () => {
    const proposals = await findMeetups(PEOPLE_REF, request(["ali", "felix"], "sam", 60), travel());
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.kind === "call" && p.placeId === null)).toBe(true);
    // ali va au cinéma à 19 h (plan accepté) : l'appel s'arrête là.
    expect(proposals.map((p) => [clock(p.start), clock(p.end)])).toEqual([["08:00", "19:00"]]);
  });

  it("le trajet estimé dépasse la journée entière", () => {
    expect(estimateTravelMinutes(P.felixHome, P.aliHome, "walk")).toBeGreaterThan(24 * 60);
  });
});

describe("S05 · Nora a un horaire vide (réussite)", () => {
  it("Nora a une seule fenêtre libre, de 8 h à 22 h", () => {
    const bounds = zonedDayBounds(day("lun"));
    const windows = getFreeWindows(person("nora"), bounds.start, bounds.end, {
      dayHours: { start: "08:00", end: "22:00" },
    });
    expect(windows).toHaveLength(1);
    expect([clock(windows[0].start), clock(windows[0].end)]).toEqual(["08:00", "22:00"]);
    expect(windows[0].placeBeforeId).toBe(P.noraHome.id);
  });

  it("avec ali, toutes les propositions respectent l'horaire d'ali", async () => {
    const proposals = await findMeetups(PEOPLE_REF, request(["ali", "nora"], "lun", 60), travel());
    expect(proposals.some((p) => p.kind === "in-person")).toBe(true);
    expectRealistic(proposals, PEOPLE_REF);
  });
});

describe("S06 · groupe d'une seule personne (cas limite)", () => {
  it("rien à expliquer et pas de « libre maintenant » à une seule personne", async () => {
    const req = request(["ali"], "sam", 60);
    expect(await explainNoMeetup(PEOPLE_REF, req, travel())).toEqual([]);
    expect(await findMeetupSoon([person("ali")], { now: at("sam", "12:00") }, travel())).toBeNull();
  });

  it("une personne inconnue dans la demande est une erreur claire", async () => {
    await expect(
      findMeetups(PEOPLE_REF, request(["ali", "fantome"], "sam", 60), travel()),
    ).rejects.toThrow("Personne inconnue : fantome");
  });
});

describe("S07 · Zoé n'a pas choisi de maison (profil incomplet)", () => {
  it("est mise de côté avec la raison « no-home »", () => {
    const { people, incomplete } = peopleOf();
    expect(incomplete).toEqual([{ id: "zoe", name: "Zoé", reason: "no-home" }]);
    expect(people.some((p) => p.id === "zoe")).toBe(false);
  });
});

describe("S08 · Sam a deux cours qui se chevauchent le jeudi (fusion)", () => {
  it("les deux blocs sont fusionnés en un seul de 8 h à 12 h", () => {
    const sam = person("sam");
    const thursday = sam.busyBlocks.filter((b) => localDay(b.start) === day("jeu"));
    const merged = mergeBusyBlocks(thursday.filter((b) => clock(b.start) < "13:00"));
    expect(merged).toHaveLength(1);
    expect([clock(merged[0].start), clock(merged[0].end)]).toEqual(["08:00", "12:00"]);
  });

  it("la première fenêtre libre commence à midi", () => {
    const bounds = zonedDayBounds(day("jeu"));
    const windows = getFreeWindows(person("sam"), bounds.start, bounds.end, {
      dayHours: { start: "08:00", end: "17:00" },
    });
    expect(windows.map((w) => [clock(w.start), clock(w.end)])).toEqual([["12:00", "17:00"]]);
  });

  it("l'écran « horaire » signale le chevauchement", () => {
    const specs = REF.blocks
      .filter((b) => b.owner_id === "sam" && b.weekday === 4)
      .map((b) => ({
        id: b.id,
        title: b.title,
        placeId: b.place_id,
        startMinute: Number(b.start_time.slice(0, 2)) * 60 + Number(b.start_time.slice(3, 5)),
        endMinute: Number(b.end_time.slice(0, 2)) * 60 + Number(b.end_time.slice(3, 5)),
        weekday: 4 as const,
        validFrom: b.valid_from,
        validUntil: b.valid_until,
      }));
    expect(findOverlaps(specs[0], specs.slice(1)).map((b) => b.title)).toEqual(["Labo de réseaux"]);
  });
});

describe("S09 · Hugo travaille de nuit, de part et d'autre de minuit", () => {
  it("le bloc qui finit à « 24:00 » finit à minuit pile, et la nuit reste occupée", () => {
    const hugo = person("hugo");
    const fri = hugo.busyBlocks.find((b) => b.title === "Quart de nuit");
    expect(fri?.end.getTime()).toBe(zonedDayBounds(day("ven")).end.getTime());
    const windows = getFreeWindows(hugo, at("ven", "20:00"), at("sam", "08:00"));
    expect(windows.map((w) => [clock(w.start), clock(w.end)])).toEqual([
      ["20:00", "22:00"],
      ["06:00", "08:00"],
    ]);
  });

  it("un bloc qui traverse minuit (22 h → 2 h) est refusé dans le formulaire", () => {
    const result = validateBlockForm({
      title: "Quart de nuit",
      placeId: null,
      start: "22:00",
      end: "02:00",
      kind: "once",
      weekdays: [],
      date: day("ven"),
      sessionStart: "",
      sessionEnd: "",
    });
    expect(result.ok).toBe(false);
  });
});

describe("S10 · changement d'heure : les heures locales restent les mêmes", () => {
  const fall = materialize(DST_FALL_MONDAY);
  const fallPeople = peopleOf(fall).people;

  it("le travail de Léo reste à 11 h le dimanche du retour à l'heure normale", () => {
    const leo = person("leo", fallPeople);
    const sunday = leo.busyBlocks.find((b) => localDay(b.start) === day("dim", DST_FALL_MONDAY));
    expect(sunday && clock(sunday.start)).toBe("11:00");
    expect(sunday?.start.toISOString()).toBe("2026-11-01T16:00:00.000Z"); // HNE : UTC−5
    const saturday = leo.busyBlocks.find((b) => localDay(b.start) === day("sam", DST_FALL_MONDAY));
    expect(saturday?.start.toISOString()).toBe("2026-10-31T14:00:00.000Z"); // HAE : UTC−4
  });

  it("le dimanche du retour à l'heure normale dure 25 h (19 h libres + 6 h de travail)", () => {
    const leo = person("leo", fallPeople);
    const bounds = zonedDayBounds(day("dim", DST_FALL_MONDAY));
    expect(minutesBetween(bounds.start, bounds.end)).toBe(25 * 60);
    const free = getFreeWindows(leo, bounds.start, bounds.end).reduce(
      (sum, w) => sum + minutesBetween(w.start, w.end),
      0,
    );
    expect(free).toBe(19 * 60);
  });

  it("au printemps, le dimanche dure 23 h : « je ne sors pas avant 10 h » dure 9 h", () => {
    const spring = peopleOf(materialize(DST_SPRING_MONDAY)).people;
    const jade = person("jade", spring);
    const quiet = jade.busyBlocks.find((b) => b.id === `calme-avant@2026-03-08`);
    expect(quiet && minutesBetween(quiet.start, quiet.end)).toBe(9 * 60);
  });
});

describe("S11 · Jade ne sort pas avant 10 h ni après 20 h (heures calmes)", () => {
  it("toutes les propositions du samedi avec Nora sont entre 10 h et 20 h", async () => {
    const proposals = await findMeetups(PEOPLE_REF, request(["jade", "nora"], "sam", 60), travel());
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.start.getTime()).toBeGreaterThanOrEqual(at("sam", "10:00").getTime());
      expect(p.end.getTime()).toBeLessThanOrEqual(at("sam", "20:00").getTime());
    }
    expectRealistic(proposals, PEOPLE_REF);
  });
});

describe("S12 · Jade a déjà sa sortie du dimanche (limite d'une sortie par jour)", () => {
  it("le dimanche, plus rien n'est proposé avec Jade", async () => {
    expect(await findMeetups(PEOPLE_REF, request(["jade", "nora"], "dim", 30), travel())).toEqual(
      [],
    );
  });

  it("le samedi (aucune sortie), la limite ne bloque rien", async () => {
    const jade = person("jade");
    expect(jade.busyBlocks.some((b) => b.id === `limite-sorties@${day("dim")}`)).toBe(true);
    expect(jade.busyBlocks.some((b) => b.id === `limite-sorties@${day("sam")}`)).toBe(false);
  });
});

describe("S13 · Lina : club d'échecs une semaine sur deux, dentiste chaque mois", () => {
  const lina = (monday: string) => {
    const data = materialize(REFERENCE_MONDAY);
    return expandBusyBlocks(
      data.blocks.filter((b) => b.owner_id === "lina"),
      { from: monday, to: dayOf(monday, "dim") },
      P.linaHome.id,
    );
  };

  it("le club a lieu cette semaine, pas la suivante, puis de nouveau la semaine d'après", () => {
    const has = (monday: string) => lina(monday).some((b) => b.title === "Club d'échecs");
    expect(has(REFERENCE_MONDAY)).toBe(true);
    expect(has(dayOf(REFERENCE_MONDAY, "lun", 1))).toBe(false);
    expect(has(dayOf(REFERENCE_MONDAY, "lun", 2))).toBe(true);
  });

  it("le dentiste revient le même quantième le mois suivant (24 décembre)", () => {
    const december = expandBusyBlocks(
      REF.blocks.filter((b) => b.id === "lina.dentiste"),
      { from: "2026-12-01", to: "2026-12-31" },
      P.linaHome.id,
    );
    expect(december.map((b) => localDay(b.start))).toEqual(["2026-12-24"]);
  });
});

describe("S14 · le cours de dessin de Lina est annulé cette semaine", () => {
  it("pas de cours ce mercredi, mais il revient mercredi prochain", () => {
    const next = dayOf(REFERENCE_MONDAY, "mer", 1);
    const blocks = expandBusyBlocks(
      REF.blocks.filter((b) => b.id === "lina.mer1"),
      { from: REFERENCE_MONDAY, to: next },
      P.linaHome.id,
    );
    expect(blocks.map((b) => localDay(b.start))).toEqual([next]);
  });
});

describe("S15 · Lina se rend disponible samedi de 13 h à 16 h, pendant son travail", () => {
  it("avec Nora, le samedi, tout se passe entre 13 h et 16 h", async () => {
    const proposals = await findMeetups(PEOPLE_REF, request(["lina", "nora"], "sam", 60), travel());
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.start.getTime()).toBeGreaterThanOrEqual(at("sam", "13:00").getTime());
      expect(p.end.getTime()).toBeLessThanOrEqual(at("sam", "16:00").getTime());
    }
    expectRealistic(proposals, PEOPLE_REF);
  });
});

describe("S16 · le lieu du dentiste a été supprimé (repli sur la maison)", () => {
  it("le bloc est compté à la maison de Lina", () => {
    const dentist = person("lina").busyBlocks.find((b) => b.title === "Dentiste");
    expect(dentist?.placeId).toBe(P.linaHome.id);
  });
});

describe("S17 · durée minimale : 45 min de pause commune le mardi midi", () => {
  const hours = { dayHours: { start: "08:00", end: "17:00" } };

  it("30 min : une rencontre au cégep de 12 h à 12 h 45", async () => {
    const proposals = await findMeetups(
      PEOPLE_REF,
      request(["ali", "sam"], "mar", 30, hours),
      travel(),
    );
    expect(proposals.map((p) => [p.kind, clock(p.start), clock(p.end)])).toEqual([
      ["in-person", "12:00", "12:45"],
    ]);
  });

  it("60 min : rien, et l'explication propose de raccourcir à 45 min", async () => {
    const req = request(["ali", "sam"], "mar", 60, hours);
    expect(await findMeetups(PEOPLE_REF, req, travel())).toEqual([]);
    const [almost] = await explainNoMeetup(PEOPLE_REF, req, travel());
    expect(almost.sharedMinutes).toBe(45);
    expect(almost.missingMinutes).toBe(15);
    expect(almost.compromises[0]).toEqual({ kind: "shorten", durationMinutes: 45 });
  });

  it("une durée minimale nulle ou NaN est une erreur", async () => {
    await expect(
      findMeetups(PEOPLE_REF, request(["ali", "sam"], "mar", 0), travel()),
    ).rejects.toThrow("La durée minimale");
    await expect(
      findMeetups(PEOPLE_REF, request(["ali", "sam"], "mar", Number.NaN), travel()),
    ).rejects.toThrow("La durée minimale");
  });
});

describe("S18 · « Qui est libre maintenant ? »", () => {
  it("lundi 11 h 05 : ali et Sam peuvent se voir au cégep dès 11 h 15", async () => {
    const soon = await findMeetupSoon(
      [person("ali"), person("sam")],
      { now: at("lun", "11:05") },
      travel(),
    );
    expect(soon?.kind).toBe("in-person");
    expect(soon && [clock(soon.start), clock(soon.end)]).toEqual(["11:15", "13:00"]);
  });

  it("lundi 21 h 50 : trop tard (la journée finit à 22 h), personne", async () => {
    const soon = await findMeetupSoon(
      [person("ali"), person("sam")],
      { now: at("lun", "21:50") },
      travel(),
    );
    expect(soon).toBeNull();
  });

  it("vendredi 13 h : ali est en cours, donc rien avec Léo", async () => {
    const soon = await findMeetupSoon(
      [person("ali"), person("leo")],
      { now: at("ven", "13:00") },
      travel(),
    );
    expect(soon).toBeNull();
  });
});

// ─── Plans ─────────────────────────────────────────────────────────────────────────────

describe("S19 · le souper accepté devient « à revoir » quand Sam reçoit un quart", () => {
  const slot = { start: at("jeu", "18:00"), end: at("jeu", "20:00") };
  const blocksOf = (rows: BusyBlockInput[], owner: string) =>
    expandBusyBlocks(
      rows.filter((r) => r.owner_id === owner),
      { from: day("jeu"), to: day("jeu") },
      "",
    );

  it("avant le quart : aucun conflit (le bloc du plan lui-même ne compte pas)", () => {
    const map = new Map([
      ["ali", blocksOf(REF.blocks, "ali")],
      ["sam", blocksOf(REF.blocks, "sam")],
    ]);
    expect(planConflicts(slot, ["ali", "sam"], map)).toEqual([]);
  });

  it("après le quart : Sam est signalé, pas ali", () => {
    const rows = [...REF.blocks, ...REF.lateBlocks];
    const map = new Map([
      ["ali", blocksOf(rows, "ali")],
      ["sam", blocksOf(rows, "sam")],
    ]);
    const conflicts = planConflicts(slot, ["ali", "sam"], map);
    expect(conflicts.map((c) => [c.personId, c.block.title, c.overlapMinutes])).toEqual([
      ["sam", "Quart de travail", 120],
    ]);
  });

  it("le souper compte aussi dans la recherche : jeudi soir, ali et Sam ne sont plus libres", async () => {
    const proposals = await findMeetups(
      PEOPLE_REF,
      request(["ali", "sam"], "jeu", 60, { dayHours: { start: "18:00", end: "20:00" } }),
      travel(),
    );
    expect(proposals).toEqual([]);
  });
});

describe("S20 · proposer un plan : formulaire valide et erreurs", () => {
  const now = at("lun", "09:00");
  const form = {
    groupId: "00000000-0000-4000-8000-000000000001",
    title: "Souper au café",
    date: day("jeu"),
    start: "18:00",
    durationMinutes: 120,
    placeId: null,
    location: "Café rue Saint-Charles",
    inviteeIds: null,
  };

  it("un plan jeudi 18 h, 2 h : accepté", () => {
    const r = validatePropose(form, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsAt).toBe(at("jeu", "20:00").toISOString());
  });

  it.each([
    ["moment passé", { date: day("lun"), start: "08:00" }, "Ce moment est déjà commencé ou passé."],
    ["trop court", { durationMinutes: 10 }, "Un plan dure de 15 minutes à 12 heures."],
    ["trop long", { durationMinutes: 13 * 60 }, "Un plan dure de 15 minutes à 12 heures."],
    ["passe minuit", { start: "23:00" }, "Un plan finit le même jour (au plus tard à minuit)."],
    ["personne d'invité", { inviteeIds: [] }, "Choisis au moins une personne à inviter."],
  ])("%s : refusé", (_label, change, message) => {
    expect(validatePropose({ ...form, ...change }, now)).toEqual({ ok: false, error: message });
  });
});

describe("S21 · plan récurrent partagé (le gym chaque semaine)", () => {
  it("chaque semaine, sans fin : accepté", () => {
    expect(validateRepeat({ unit: "week", every: 1, until: null }, day("lun"))).toEqual({
      ok: true,
      value: { unit: "week", every: 1, until: null },
    });
  });

  it.each([
    ["tous les 0", { unit: "week", every: 0, until: null }, "La répétition va de 1 à 99."],
    [
      "fin avant le début",
      { unit: "week", every: 1, until: "2026-11-01" },
      "La fin doit être après la première fois.",
    ],
    [
      "fin dans 11 ans",
      { unit: "week", every: 1, until: "2037-12-01" },
      "La fin doit être dans moins de 10 ans.",
    ],
  ])("%s : refusé", (_label, raw, message) => {
    expect(validateRepeat(raw, day("lun"))).toEqual({ ok: false, error: message });
  });
});

// ─── Planificateur d'étude ─────────────────────────────────────────────────────────────

describe("S22 · planificateur d'étude d'ali", () => {
  it("examen de chimie jeudi 10 h, 4 h d'étude : séances placées avant, hors des cours", async () => {
    const ali = person("ali");
    const plan = await planStudySessions(
      ali,
      [
        {
          id: "chimie",
          kind: "exam",
          course: "Chimie",
          dueAt: at("jeu", "10:00"),
          estimatedHours: 4,
          difficulty: 2,
        },
      ],
      DEFAULT_STUDY_PREFERENCES,
      travel(),
      at("lun", "07:00"),
    );
    expect(plan.warnings).toEqual([]);
    const total = plan.sessions.reduce((s, x) => s + minutesBetween(x.start, x.end), 0);
    expect(total).toBe(240);
    for (const s of plan.sessions) {
      expect(s.end.getTime()).toBeLessThanOrEqual(at("jeu", "10:00").getTime());
      for (const b of ali.busyBlocks) {
        expect(b.start < s.end && b.end > s.start, `${b.title} / ${clock(s.start)}`).toBe(false);
      }
    }
  });

  it("examen demain matin avec 10 h à faire : avertissement « il manque »", async () => {
    const plan = await planStudySessions(
      person("ali"),
      [
        {
          id: "physique",
          kind: "exam",
          course: "Physique",
          dueAt: at("mar", "08:00"),
          estimatedHours: 10,
          difficulty: 3,
        },
      ],
      DEFAULT_STUDY_PREFERENCES,
      travel(),
      at("lun", "16:00"),
    );
    expect(plan.warnings.map((w) => w.kind)).toContain("missing");
    expect(plan.warnings[0].missingMinutes).toBeGreaterThan(0);
  });

  it("examen déjà passé : avertissement « passé », aucune séance", async () => {
    const plan = await planStudySessions(
      person("ali"),
      [
        {
          id: "bio",
          kind: "exam",
          course: "Biologie",
          dueAt: at("lun", "08:00"),
          estimatedHours: 2,
          difficulty: 1,
        },
      ],
      DEFAULT_STUDY_PREFERENCES,
      travel(),
      at("mar", "08:00"),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.warnings.map((w) => w.kind)).toEqual(["past"]);
  });
});

// ─── Import .ics ───────────────────────────────────────────────────────────────────────

const ICS_COURS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Freecrew//Jeux de données//FR",
  "BEGIN:VEVENT",
  "UID:chimie@test",
  "DTSTART;TZID=America/Toronto:20261123T080000",
  "DTEND;TZID=America/Toronto:20261123T100000",
  "RRULE:FREQ=WEEKLY;COUNT=10",
  "SUMMARY:Chimie générale",
  "LOCATION:Cégep Édouard-Montpetit",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("S23 · import d'un horaire .ics", () => {
  const today = REFERENCE_MONDAY;

  it("un cours chaque lundi devient un bloc hebdomadaire au bon lieu", () => {
    const r = parseIcs(ICS_COURS, { today });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.blocks).toHaveLength(1);
    expect(r.value.blocks[0]).toMatchObject({ title: "Chimie générale", weekday: 1 });
    expect(r.value.locations).toEqual(["Cégep Édouard-Montpetit"]);
  });

  it("un texte qui n'est pas un calendrier est refusé sans planter", () => {
    expect(parseIcs("bonjour, voici mon horaire", { today }).ok).toBe(false);
  });

  it("un calendrier sans événement donne un aperçu vide", () => {
    const r = parseIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", { today });
    if (r.ok) expect(r.value.blocks).toEqual([]);
    else expect(r.error).toBeTruthy();
  });

  it("un fichier trop gros est refusé", () => {
    const big = ICS_COURS.replace("Chimie générale", "x".repeat(1_100_000));
    expect(parseIcs(big, { today }).ok).toBe(false);
  });
});

// ─── Trajets et lieux ──────────────────────────────────────────────────────────────────

function source(matrix: TravelMatrixSource["matrix"]): TravelMatrixSource {
  return { name: "api-test", maxElements: 100, supports: () => true, matrix };
}

describe("S24 · l'API de trajets tombe en panne : repli sur l'estimation", () => {
  const places = [P.aliHome, P.mayaUdem];

  it("API en panne : même temps que l'estimation, et l'échec est compté", async () => {
    const provider = new FallbackTravelProvider({
      sources: [source(async () => Promise.reject(new Error("quota dépassé")))],
      onError: () => {},
    });
    await provider.prefetch([{ mode: "transit", places }]);
    expect(provider.lastPrefetch.failures).toBe(1);
    expect(await provider.minutes(P.aliHome, P.mayaUdem, "transit")).toBe(
      estimateTravelMinutes(P.aliHome, P.mayaUdem, "transit"),
    );
    expect(provider.isMeasured(P.aliHome, P.mayaUdem, "transit")).toBe(false);
  });

  it("API trop lente (délai dépassé) : estimation aussi", async () => {
    const provider = new FallbackTravelProvider({
      sources: [source(() => new Promise(() => {}))],
      timeoutMs: 20,
      onError: () => {},
    });
    await provider.prefetch([{ mode: "transit", places }]);
    expect(provider.lastPrefetch.failures).toBe(1);
    expect(provider.isMeasured(P.aliHome, P.mayaUdem, "transit")).toBe(false);
  });

  it("API qui répond : son temps (en minutes, arrondi vers le haut) est utilisé", async () => {
    const provider = new FallbackTravelProvider({
      sources: [source(async (o, d) => o.map(() => d.map(() => 61 * 60 + 1)))],
    });
    await provider.prefetch([{ mode: "transit", places }]);
    expect(await provider.minutes(P.aliHome, P.mayaUdem, "transit")).toBe(62);
  });
});

describe("S25 · lieu aux coordonnées impossibles (erreur claire)", () => {
  it("le calcul refuse le lieu au lieu de l'oublier en silence", () => {
    const bad = { id: "mauvais", name: "Lieu mal saisi", lat: 200, lng: -73.5 };
    expect(() => estimateTravelMinutes(bad, P.aliHome, "car")).toThrow("Coordonnées invalides");
  });
});

describe("S26 · recherche d'une adresse introuvable", () => {
  const geocoder = (body: unknown, status = 200) =>
    createNominatimGeocoder({
      fetch: async () => new Response(JSON.stringify(body), { status }),
      sleep: async () => {},
    });

  it("aucun résultat : liste vide (l'écran dit « introuvable »)", async () => {
    expect(await geocoder([]).search("12 rue qui n'existe pas, Longueuil")).toEqual([]);
  });

  it("service en panne : erreur « indisponible »", async () => {
    await expect(geocoder({}, 500).search("Cégep Édouard-Montpetit")).rejects.toMatchObject({
      code: "indisponible",
    });
  });
});

describe("S27 · formulaire de bloc invalide", () => {
  const base = {
    title: "Chimie",
    placeId: null,
    start: "10:00",
    end: "12:00",
    kind: "weekly" as const,
    weekdays: [1],
    date: "",
    sessionStart: "2026-08-24",
    sessionEnd: "2026-12-18",
  };

  it("un bloc normal est accepté", () => {
    expect(validateBlockForm(base).ok).toBe(true);
  });

  it.each([
    ["fin avant le début", { start: "12:00", end: "10:00" }],
    ["titre vide", { title: "   " }],
    ["titre trop long", { title: "x".repeat(101) }],
    ["aucun jour coché", { weekdays: [] }],
    ["session à l'envers", { sessionStart: "2026-12-18", sessionEnd: "2026-08-24" }],
  ])("%s : refusé", (_label, change) => {
    expect(validateBlockForm({ ...base, ...change }).ok).toBe(false);
  });
});

describe("S28 · « Les quatre » sur toute la semaine (classement)", () => {
  it("au plus 3 propositions par jour, de la meilleure à la moins bonne, toutes réalistes", async () => {
    const people = PEOPLE_REF;
    const proposals = await findMeetups(
      people,
      {
        personIds: groupMembers("quatre"),
        dates: REF.week,
        minDurationMinutes: 60,
        bufferMinutes: 5,
      },
      travel(),
    );
    expect(proposals.length).toBeGreaterThan(0);
    const perDay = new Map<string, number>();
    for (const p of proposals)
      perDay.set(localDay(p.start), (perDay.get(localDay(p.start)) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(3);
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i - 1].score).toBeGreaterThanOrEqual(proposals[i].score);
    }
    for (const p of proposals)
      expect(Object.keys(p.travelByPerson).sort()).toEqual(["ali", "leo", "maya", "sam"]);
    expectRealistic(proposals, people);
  });
});
