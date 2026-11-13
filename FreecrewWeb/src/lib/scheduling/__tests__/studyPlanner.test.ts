import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  type AcceptedStudySession,
  DEFAULT_STUDY_PREFERENCES,
  assertStudyPreferences,
  checkStudySession,
  deadlineLabel,
  distributeMinutes,
  findStudyConflicts,
  formatStudyDuration,
  planStudySessions,
  requiredMinutes,
  rescheduleStudySessions,
  sessionFits,
} from "../studyPlanner";
import { MS_PER_MINUTE, TIME_ZONE, zonedTime } from "../time";
import { EstimatedTravelProvider } from "../travel";
import type { BusyBlock, Deadline, Person, Place, StudyPreferences, StudySession } from "../types";
import { FakeTravelProvider } from "./fakeTravel";

// ─── Données ─────────────────────────────────────────────────────────────────────────────

const HOME: Place = { id: "maison", name: "Maison", lat: 45.5369, lng: -73.5107 };
const CEGEP: Place = { id: "cegep", name: "Cégep", lat: 45.5364, lng: -73.495 };
const MTL: Place = { id: "mtl", name: "Montréal (travail)", lat: 45.5085, lng: -73.5665 };
const AMI: Place = { id: "chez-ami", name: "Chez un ami", lat: 45.52, lng: -73.6 };

/** Trajets fixes : maison ↔ cégep 15 min, Montréal à 40 min de tout, ami à 30 min. */
const travel = () =>
  new FakeTravelProvider(
    [
      ["maison", "cegep", 15],
      ["maison", "mtl", 40],
      ["cegep", "mtl", 40],
    ],
    30,
  );

/** Semaine du lundi 15 septembre 2025 (heure avancée). */
const DAY = {
  dim: "2025-09-14",
  lun: "2025-09-15",
  mar: "2025-09-16",
  mer: "2025-09-17",
  jeu: "2025-09-18",
  ven: "2025-09-19",
  sam: "2025-09-20",
  dim2: "2025-09-21",
} as const;
type D = keyof typeof DAY;
const at = (d: D, t: string) => zonedTime(DAY[d], t);
let n = 0;
const blk = (d: D, start: string, end: string, placeId: string, title = "Cours"): BusyBlock => ({
  id: `b${n++}`,
  start: at(d, start),
  end: at(d, end),
  placeId,
  title,
});

function person(busyBlocks: BusyBlock[], places: Place[] = [HOME, CEGEP, MTL]): Person {
  return {
    id: "ali",
    name: "ali",
    homePlaceId: HOME.id,
    travelMode: "transit",
    places,
    busyBlocks,
  };
}

const exam = (id: string, course: string, due: Date, hours: number | null = null): Deadline => ({
  id,
  kind: "exam",
  course,
  dueAt: due,
  estimatedHours: hours,
  difficulty: 2,
});

const prefs = (over: Partial<StudyPreferences> = {}): StudyPreferences => ({
  ...DEFAULT_STUDY_PREFERENCES,
  ...over,
});

const minutes = (s: { start: Date; end: Date }) =>
  (s.end.getTime() - s.start.getTime()) / MS_PER_MINUTE;
const total = (ss: readonly StudySession[]) => ss.reduce((t, s) => t + minutes(s), 0);
const localDay = (d: Date) => formatInTimeZone(d, TIME_ZONE, "yyyy-MM-dd");
const hhmm = (d: Date) => formatInTimeZone(d, TIME_ZONE, "HH:mm");
const fmt = (s: StudySession) =>
  `${localDay(s.start)} ${hhmm(s.start)}-${hhmm(s.end)} ${s.placeId}`;

/** Lundi 7 h : maintenant. */
const NOW = at("lun", "07:00");

/**
 * Vérification indépendante (sans getFreeWindows) : aucune séance ne chevauche un bloc ou une
 * autre séance, et le trajet depuis le bloc d'avant / vers le bloc d'après tient (marge
 * comprise) quand le lieu change. Hors blocs, on est à la maison.
 */
async function assertRealistic(p: Person, sessions: StudySession[], buffer: number) {
  const tp = travel();
  const byId = new Map(p.places.map((x) => [x.id, x]));
  for (const s of sessions) {
    const others: BusyBlock[] = [
      ...p.busyBlocks,
      ...sessions
        .filter((o) => o !== s)
        .map((o, i) => ({
          id: `s${i}`,
          start: o.start,
          end: o.end,
          placeId: o.placeId,
          title: "",
        })),
    ];
    for (const b of others) {
      const overlap = b.start < s.end && s.start < b.end;
      expect(overlap, `${fmt(s)} chevauche ${b.title} ${hhmm(b.start)}`).toBe(false);
    }
    const dayStart = zonedTime(localDay(s.start), "00:00");
    const dayEnd = zonedTime(localDay(s.start), "24:00");
    const prev = others
      .filter((b) => b.end <= s.start)
      .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
    const next = others
      .filter((b) => b.start >= s.end)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    const prevPlace = prev && prev.end > dayStart ? prev.placeId : p.homePlaceId;
    const prevEnd = prev && prev.end > dayStart ? prev.end : dayStart;
    const nextPlace = next && next.start < dayEnd ? next.placeId : p.homePlaceId;
    const nextStart = next && next.start < dayEnd ? next.start : dayEnd;
    const to = await tp.minutes(byId.get(prevPlace)!, byId.get(s.placeId)!, p.travelMode);
    const from = await tp.minutes(byId.get(s.placeId)!, byId.get(nextPlace)!, p.travelMode);
    const need = (m: number) => (m > 0 ? m + buffer : 0);
    expect(
      (s.start.getTime() - prevEnd.getTime()) / MS_PER_MINUTE,
      `${fmt(s)} : trajet depuis ${prevPlace}`,
    ).toBeGreaterThanOrEqual(need(to));
    expect(
      (nextStart.getTime() - s.end.getTime()) / MS_PER_MINUTE,
      `${fmt(s)} : trajet vers ${nextPlace}`,
    ).toBeGreaterThanOrEqual(need(from));
  }
}

// ─── Cas limites de la section 3 bis ─────────────────────────────────────────────────────

describe("planStudySessions : cas limites de la section 3 bis", () => {
  it("examen mardi, 4 h, pauses au cégep lundi et mardi matin : les séances tombent dans ces pauses, pas à Montréal", async () => {
    const ali = person([
      blk("lun", "08:00", "10:00", CEGEP.id),
      blk("lun", "12:00", "16:00", CEGEP.id),
      blk("lun", "16:45", "22:00", MTL.id, "Travail"),
      blk("mar", "08:00", "09:00", CEGEP.id),
      blk("mar", "11:00", "12:00", CEGEP.id),
      blk("mar", "13:00", "16:00", CEGEP.id, "Examen de chimie"),
    ]);
    const due = at("mar", "13:00");
    const { sessions, warnings } = await planStudySessions(
      ali,
      [exam("chimie", "chimie", due, 4)],
      prefs(),
      travel(),
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(total(sessions)).toBeGreaterThanOrEqual(240);
    const pauses = [
      [at("lun", "10:00"), at("lun", "12:00")],
      [at("mar", "09:00"), at("mar", "11:00")],
      [at("mar", "12:00"), at("mar", "13:00")],
    ];
    for (const s of sessions) {
      expect(s.placeId, fmt(s)).toBe(CEGEP.id);
      expect(
        pauses.some(([a, b]) => a <= s.start && s.end <= b),
        fmt(s),
      ).toBe(true);
      expect(s.end <= due).toBe(true);
    }
    // Une courte révision la veille (lundi), et pas tout la veille.
    const lundi = sessions.filter((s) => localDay(s.start) === DAY.lun);
    expect(lundi[0].kind).toBe("review");
    expect(total(lundi)).toBeLessThanOrEqual(120);
    await assertRealistic(ali, sessions, 5);
  });

  it("pas assez de temps libre : alerte avec les heures manquantes", async () => {
    const plein = (["lun", "mar", "mer", "jeu"] as const).flatMap((d) =>
      d === "lun"
        ? [blk(d, "08:00", "10:00", CEGEP.id), blk(d, "11:00", "22:00", CEGEP.id)]
        : [blk(d, "08:00", "22:00", CEGEP.id)],
    );
    const { sessions, warnings } = await planStudySessions(
      person(plein),
      [exam("chimie", "chimie", at("jeu", "09:00"))], // difficulté 2 : 5 h
      prefs(),
      travel(),
      NOW,
    );
    expect(sessions.map(fmt)).toEqual(["2025-09-15 10:00-11:00 cegep"]);
    expect(warnings).toEqual([
      {
        kind: "missing",
        deadlineId: "chimie",
        missingMinutes: 240,
        message: "Il te manque 4 h avant l'examen de chimie.",
      },
    ]);
  });

  it("deux examens la même semaine : les deux reçoivent du temps", async () => {
    const semaine = (["lun", "mar", "mer", "jeu", "ven"] as const).flatMap((d) => [
      blk(d, "08:00", "10:00", CEGEP.id),
      blk(d, "12:00", "22:00", CEGEP.id),
    ]);
    const ali = person(semaine);
    const chimie = exam("chimie", "chimie", at("mer", "13:00"), 3);
    const physique = exam("physique", "physique", at("ven", "13:00"), 3);
    // L'ordre donné ne compte pas : la plus proche est traitée d'abord.
    const { sessions, warnings } = await planStudySessions(
      ali,
      [physique, chimie],
      prefs(),
      travel(),
      NOW,
    );
    expect(warnings).toEqual([]);
    const of = (id: string) => sessions.filter((s) => s.deadlineId === id);
    expect(total(of("chimie"))).toBeGreaterThanOrEqual(180);
    expect(total(of("physique"))).toBeGreaterThanOrEqual(180);
    expect(of("chimie").every((s) => s.end <= chimie.dueAt)).toBe(true);
    expect(sessions[0].deadlineId).toBe("chimie");
    await assertRealistic(ali, sessions, 5);
  });

  it("deux examens et peu de temps : le plus proche d'abord, l'autre reçoit quand même du temps", async () => {
    const semaine = (["lun", "mar", "mer", "jeu", "ven"] as const).flatMap((d) => [
      blk(d, "08:00", "10:00", CEGEP.id),
      blk(d, "11:00", "22:00", CEGEP.id),
    ]);
    const { sessions, warnings } = await planStudySessions(
      person(semaine),
      [
        exam("physique", "physique", at("ven", "13:00"), 3),
        exam("chimie", "chimie", at("mer", "13:00"), 3),
      ],
      prefs(),
      travel(),
      NOW,
    );
    const of = (id: string) => total(sessions.filter((s) => s.deadlineId === id));
    const missing = (id: string) => warnings.find((w) => w.deadlineId === id)?.missingMinutes ?? 0;
    expect(of("chimie")).toBeGreaterThan(of("physique"));
    expect(of("physique")).toBeGreaterThan(0);
    expect(missing("chimie")).toBeLessThan(missing("physique"));
    expect(warnings.find((w) => w.deadlineId === "physique")?.message).toBe(
      `Il te manque ${formatStudyDuration(missing("physique"))} avant l'examen de physique.`,
    );
  });

  it("échéance déjà passée : rien de proposé", async () => {
    const { sessions, warnings } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", at("dim", "13:00"))],
      prefs(),
      travel(),
      NOW,
    );
    expect(sessions).toEqual([]);
    expect(warnings).toEqual([
      {
        kind: "past",
        deadlineId: "chimie",
        missingMinutes: 0,
        message: "L'examen de chimie est déjà passé : rien de proposé.",
      },
    ]);
  });

  it("échéance aujourd'hui : seulement une courte révision, avant l'examen", async () => {
    const due = at("lun", "14:00");
    const { sessions, warnings } = await planStudySessions(
      person([blk("lun", "08:00", "10:00", CEGEP.id)]),
      [exam("chimie", "chimie", due, 6)],
      prefs(),
      travel(),
      NOW,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe("review");
    expect(minutes(sessions[0])).toBe(45);
    expect(sessions[0].end <= due).toBe(true);
    expect(warnings.map((w) => w.message)).toEqual([
      "L'examen de chimie est aujourd'hui : seulement une courte révision.",
    ]);
  });
});

// ─── Règles des préférences ─────────────────────────────────────────────────────────────

describe("planStudySessions : préférences", () => {
  it("respecte le maximum par jour et la durée min/max d'une séance (pas de 15 min)", async () => {
    const p = prefs({ minSessionMinutes: 45, maxSessionMinutes: 90, maxStudyMinutesPerDay: 120 });
    const { sessions, warnings } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", at("sam", "09:00"), 20)],
      p,
      travel(),
      NOW,
    );
    expect(sessions.length).toBeGreaterThan(3);
    const perDay = new Map<string, number>();
    for (const s of sessions) {
      expect(minutes(s)).toBeGreaterThanOrEqual(45);
      expect(minutes(s)).toBeLessThanOrEqual(90);
      expect(minutes(s) % 15).toBe(0);
      expect(s.start.getTime() % (15 * MS_PER_MINUTE)).toBe(0);
      perDay.set(localDay(s.start), (perDay.get(localDay(s.start)) ?? 0) + minutes(s));
    }
    for (const [day, m] of perDay) expect(m, day).toBeLessThanOrEqual(120);
    // 20 h ne rentrent pas dans 5 jours à 2 h par jour : on le dit au lieu de surcharger.
    expect(warnings[0].kind).toBe("missing");
  });

  it("le maximum par jour compte les séances déjà acceptées, et elles comptent comme faites", async () => {
    const accepted: StudySession[] = [
      {
        deadlineId: "chimie",
        start: at("mar", "09:00"),
        end: at("mar", "10:30"),
        placeId: HOME.id,
        kind: "study",
      },
    ];
    const { sessions } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", at("ven", "09:00"), 3)],
      prefs({ maxStudyMinutesPerDay: 120 }),
      travel(),
      NOW,
      { accepted },
    );
    const mardi = sessions.filter((s) => localDay(s.start) === DAY.mar);
    expect(total(mardi)).toBe(0); // 90 min acceptées + une séance de 45 min > 120
    // 3 h nécessaires, 1 h 30 déjà acceptée : on propose environ 1 h 30 de plus.
    expect(total(sessions)).toBeGreaterThanOrEqual(90);
    expect(total(sessions)).toBeLessThan(180);
    for (const s of sessions) {
      expect(s.start >= accepted[0].end || s.end <= accepted[0].start).toBe(true);
    }
  });

  it("une pause entre deux séances, une révision la veille avant l'heure limite, jamais tout la veille", async () => {
    const due = at("ven", "09:00");
    const { sessions } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", due, 6)],
      prefs({ breakMinutes: 20, eveCutoff: "20:00" }),
      travel(),
      NOW,
    );
    const sorted = [...sessions].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i].start.getTime() - sorted[i - 1].end.getTime()) / MS_PER_MINUTE;
      expect(gap).toBeGreaterThanOrEqual(20);
    }
    const veille = sessions.filter((s) => localDay(s.start) === DAY.jeu);
    expect(veille.map((s) => s.kind)).toEqual(["review"]);
    expect(veille.every((s) => s.end <= at("jeu", "20:00"))).toBe(true);
    // Plus de poids 2 ou 3 jours avant (mardi, mercredi) que 4 jours avant (lundi).
    const jour = (d: D) => total(sessions.filter((s) => localDay(s.start) === DAY[d]));
    expect(jour("mer") + jour("mar")).toBeGreaterThan(jour("lun"));
  });

  it("garde une part des soirées et des fins de semaine libre", async () => {
    // Semaine vide, examen le lundi suivant : beaucoup de temps libre.
    const due = zonedTime("2025-09-22", "09:00");
    const p = prefs({ keepFreeRatio: 0.5, maxStudyMinutesPerDay: 600, maxSessionMinutes: 240 });
    const { sessions } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", due, 60)],
      p,
      travel(),
      NOW,
    );
    // Samedi : 14 h libres dans les heures d'étude (8 h à 22 h), on en garde au moins la moitié.
    const samedi = sessions.filter((s) => localDay(s.start) === DAY.sam);
    expect(total(samedi)).toBeGreaterThan(0);
    expect(total(samedi)).toBeLessThanOrEqual(420);
    // Soirée de semaine (18 h à 22 h = 4 h) : au plus 2 h d'étude.
    const mardiSoir = sessions
      .filter((s) => localDay(s.start) === DAY.mar)
      .reduce((t, s) => {
        const from = Math.max(s.start.getTime(), at("mar", "18:00").getTime());
        return t + Math.max(0, (s.end.getTime() - from) / MS_PER_MINUTE);
      }, 0);
    expect(mardiSoir).toBeLessThanOrEqual(120);
  });

  it("dans les heures d'étude seulement", async () => {
    const { sessions } = await planStudySessions(
      person([]),
      [exam("chimie", "chimie", at("ven", "09:00"), 10)],
      prefs({ studyHours: { start: "10:00", end: "17:00" } }),
      travel(),
      NOW,
    );
    for (const s of sessions) {
      expect(hhmm(s.start) >= "10:00", fmt(s)).toBe(true);
      expect(hhmm(s.end) <= "17:00", fmt(s)).toBe(true);
    }
  });

  it("n'étudie jamais à un lieu qui n'est pas à moi (lieu d'un ami) : maison ou lieu permis", async () => {
    const ali = person(
      [
        blk("lun", "08:00", "12:00", AMI.id, "Plan de groupe"),
        blk("lun", "14:00", "22:00", AMI.id, "Plan de groupe"),
      ],
      [HOME, CEGEP, MTL, AMI],
    );
    const { sessions } = await planStudySessions(
      ali,
      [exam("chimie", "chimie", at("mar", "09:00"), 2)],
      prefs(),
      travel(),
      NOW,
      { studyPlaceIds: [HOME.id, CEGEP.id, MTL.id] },
    );
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.placeId !== AMI.id)).toBe(true);
    await assertRealistic(ali, sessions, 5);
  });

  it("refuse des préférences hors bornes", () => {
    expect(() => assertStudyPreferences(prefs({ minSessionMinutes: 10 }))).toThrow();
    expect(() => assertStudyPreferences(prefs({ maxSessionMinutes: 30 }))).toThrow();
    expect(() => assertStudyPreferences(prefs({ keepFreeRatio: 1 }))).toThrow();
    expect(() => assertStudyPreferences(prefs({ minSessionMinutes: 50 }))).toThrow(/15/);
    expect(() =>
      assertStudyPreferences(prefs({ studyHours: { start: "20:00", end: "20:30" } })),
    ).toThrow();
    expect(() => assertStudyPreferences(prefs())).not.toThrow();
  });
});

// ─── Réalisme : jamais sur un bloc ni sur le trajet ──────────────────────────────────────

describe("planStudySessions : jamais sur un bloc occupé ni sur le trajet", () => {
  /** Générateur pseudo-aléatoire déterministe (mulberry32). */
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`horaire aléatoire n° ${seed}`, async () => {
      const r = rng(seed);
      const places = [HOME.id, CEGEP.id, MTL.id];
      const blocks: BusyBlock[] = [];
      for (const d of ["lun", "mar", "mer", "jeu", "ven", "sam"] as const) {
        let t = 7 * 60 + Math.floor(r() * 8) * 15;
        while (t < 21 * 60) {
          const length = (2 + Math.floor(r() * 10)) * 15;
          const end = Math.min(t + length, 23 * 60);
          const clock = (m: number) =>
            `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          blocks.push(blk(d, clock(t), clock(end), places[Math.floor(r() * 3)]));
          t = end + (1 + Math.floor(r() * 12)) * 15;
        }
      }
      const ali = person(blocks);
      const { sessions } = await planStudySessions(
        ali,
        [exam("a", "chimie", at("jeu", "13:00"), 4), exam("b", "physique", at("sam", "10:00"), 6)],
        prefs({ bufferMinutes: 5 }),
        travel(),
        NOW,
      );
      expect(sessions.length).toBeGreaterThan(0);
      await assertRealistic(ali, sessions, 5);
      for (const s of sessions) {
        expect(
          await sessionFits(
            ali,
            s,
            sessions.filter((o) => o !== s),
            travel(),
            5,
          ),
        ).toBe(true);
      }
    });
  }

  it("avec l'estimation maison et l'heure normale (changement d'heure du 2 novembre 2025)", async () => {
    const ali = person([
      {
        id: "x",
        start: zonedTime("2025-11-03", "08:00"),
        end: zonedTime("2025-11-03", "12:00"),
        placeId: CEGEP.id,
        title: "Cours",
      },
    ]);
    const { sessions } = await planStudySessions(
      ali,
      [exam("chimie", "chimie", zonedTime("2025-11-04", "13:00"), 3)],
      prefs(),
      new EstimatedTravelProvider(),
      zonedTime("2025-10-31", "18:00"),
    );
    expect(total(sessions)).toBeGreaterThanOrEqual(180);
    for (const s of sessions) {
      expect(hhmm(s.start).endsWith(":00") || hhmm(s.start).match(/:(15|30|45)$/)).toBeTruthy();
    }
  });
});

// ─── Vérification, conflits et replanification ──────────────────────────────────────────

describe("checkStudySession (déplacement revalidé côté serveur)", () => {
  const ali = person([
    blk("mar", "08:00", "10:00", CEGEP.id),
    blk("mar", "12:00", "14:00", MTL.id),
  ]);
  const deadline = exam("chimie", "chimie", at("jeu", "09:00"), 4);
  const s = (start: string, end: string, placeId = CEGEP.id): StudySession => ({
    deadlineId: "chimie",
    start: at("mar", start),
    end: at("mar", end),
    placeId,
    kind: "study",
  });
  const check = (session: StudySession, others: StudySession[] = []) =>
    checkStudySession(ali, session, deadline, others, prefs(), travel(), NOW);

  it("accepte une séance libre, trajets compris", async () => {
    expect(await check(s("10:00", "11:00"))).toBeNull();
  });
  it("refuse une séance sur un bloc occupé", async () => {
    expect(await check(s("09:00", "10:00"))).toMatch(/pas libre/);
  });
  it("refuse une séance qui ne laisse pas le temps d'aller à Montréal", async () => {
    // Cégep → Montréal : 40 min + 5 de marge ; finir à 11 h 30 au cégep ne laisse que 30 min.
    expect(await check(s("10:30", "11:30"))).toMatch(/trajet/);
    expect(await check(s("10:00", "11:15"))).toBeNull();
  });
  it("refuse une séance qui chevauche une autre séance", async () => {
    expect(await check(s("10:00", "11:00"), [s("10:30", "11:15")])).toMatch(/pas libre/);
  });
  it("refuse une durée hors bornes, hors du quart d'heure, passée ou après l'échéance", async () => {
    expect(await check(s("10:00", "10:30"))).toMatch(/dure de 45 min à 2 h/);
    expect(await check(s("10:00", "12:15"))).toMatch(/dure/);
    expect(await check(s("10:05", "11:05"))).toMatch(/quart d'heure/);
    const passee = { ...s("10:00", "11:00"), start: at("dim", "10:00"), end: at("dim", "11:00") };
    expect(await check(passee)).toMatch(/passée/);
    const apres = { ...s("10:00", "11:00"), start: at("jeu", "10:00"), end: at("jeu", "11:00") };
    expect(await check(apres)).toMatch(/après l'examen de chimie/);
  });
  it("refuse un lieu non permis", async () => {
    const r = await checkStudySession(
      ali,
      s("10:00", "11:00"),
      deadline,
      [],
      prefs(),
      travel(),
      NOW,
      [HOME.id],
    );
    expect(r).toBe("Lieu introuvable.");
  });
});

describe("findStudyConflicts et rescheduleStudySessions", () => {
  const accepted = (
    id: string,
    d: D,
    start: string,
    end: string,
    movable = true,
  ): AcceptedStudySession => ({
    id,
    deadlineId: "chimie",
    start: at(d, start),
    end: at(d, end),
    placeId: HOME.id,
    kind: "study",
    movable,
  });

  it("un plan de groupe par-dessus une séance déplaçable : conflit ; non déplaçable ou passée : rien", async () => {
    const ali = person([blk("mar", "18:00", "20:00", MTL.id, "Plan de groupe")]);
    const list = [
      accepted("s1", "mar", "18:30", "19:30"),
      accepted("s2", "mar", "18:00", "19:00", false),
      accepted("s3", "mar", "10:00", "11:00"),
      accepted("s4", "dim", "10:00", "11:00"),
    ];
    // s3 et s4 ne touchent rien ; s2 n'est pas déplaçable.
    expect(await findStudyConflicts(ali, list, travel(), 5, NOW)).toEqual(["s1"]);
  });

  it("un trajet qui ne tient plus est aussi un conflit", async () => {
    // Séance à la maison jusqu'à 17 h 30, puis un plan à Montréal à 18 h (40 min de trajet).
    const ali = person([blk("mar", "18:00", "20:00", MTL.id, "Plan de groupe")]);
    expect(
      await findStudyConflicts(ali, [accepted("s1", "mar", "16:30", "17:30")], travel(), 5, NOW),
    ).toEqual(["s1"]);
  });

  it("replace une séance en conflit au moment libre le plus proche, avant l'échéance", async () => {
    const ali = person([
      blk("mar", "08:00", "18:00", CEGEP.id),
      blk("mar", "18:00", "21:00", MTL.id, "Plan de groupe"),
    ]);
    const s1 = accepted("s1", "mar", "18:30", "19:30");
    const deadline = exam("chimie", "chimie", at("jeu", "09:00"), 4);
    const { moves, warnings } = await rescheduleStudySessions(
      ali,
      [deadline],
      [s1],
      [],
      prefs(),
      travel(),
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(moves).toHaveLength(1);
    const moved = moves[0].session;
    expect(minutes(moved)).toBe(60);
    expect(moved.end <= deadline.dueAt).toBe(true);
    expect(await sessionFits(ali, moved, [], travel(), 5)).toBe(true);
    // Mardi soir n'est plus possible (plan à Montréal jusqu'à 21 h, puis le trajet) : le
    // moment libre le plus proche est lundi ou mercredi à la même heure.
    expect([DAY.lun, DAY.mer]).toContain(localDay(moved.start));
  });

  it("sans place avant l'échéance : avertissement, aucune proposition", async () => {
    const ali = person([
      blk("lun", "07:00", "23:00", CEGEP.id),
      blk("mar", "07:00", "23:00", CEGEP.id),
    ]);
    const { moves, warnings } = await rescheduleStudySessions(
      ali,
      [exam("chimie", "chimie", at("mer", "07:00"), 4)],
      [accepted("s1", "mar", "18:30", "19:30")],
      [],
      prefs(),
      travel(),
      NOW,
    );
    expect(moves).toEqual([]);
    expect(warnings[0].message).toBe(
      "Pas de moment libre pour replacer une séance avant l'examen de chimie.",
    );
  });
});

describe("petits outils", () => {
  it("heures nécessaires : estimation, sinon selon la difficulté (3 h, 5 h, 8 h)", () => {
    const d = exam("x", "x", NOW);
    expect(requiredMinutes({ ...d, estimatedHours: 2.5 })).toBe(150);
    expect(requiredMinutes({ ...d, estimatedHours: null, difficulty: 1 })).toBe(180);
    expect(requiredMinutes({ ...d, estimatedHours: null, difficulty: 2 })).toBe(300);
    expect(requiredMinutes({ ...d, estimatedHours: null, difficulty: 3 })).toBe(480);
  });

  it("libellés en français (élision) et durées", () => {
    expect(deadlineLabel({ kind: "exam", course: "chimie" })).toBe("l'examen de chimie");
    expect(deadlineLabel({ kind: "exam", course: "Anglais" })).toBe("l'examen d'Anglais");
    expect(deadlineLabel({ kind: "assignment", course: "histoire" })).toBe("le travail d'histoire");
    expect(formatStudyDuration(120)).toBe("2 h");
    expect(formatStudyDuration(90)).toBe("1 h 30");
    expect(formatStudyDuration(45)).toBe("45 min");
  });

  it("répartition : plus de poids 2-3 jours avant, rien la veille, le total est atteint", () => {
    const days = [6, 5, 4, 3, 2, 1, 0].map((b, i) => ({ day: `j${i}`, daysBefore: b }));
    const t = distributeMinutes(300, days, 45, 120);
    const at_ = (b: number) => t.get(`j${6 - b}`) ?? 0;
    expect(at_(1)).toBe(0);
    expect(at_(2)).toBeGreaterThanOrEqual(at_(4));
    expect(at_(3)).toBeGreaterThanOrEqual(at_(5));
    expect([...t.values()].reduce((a, b) => a + b, 0)).toBe(300);
    for (const v of t.values()) expect(v).toBeGreaterThanOrEqual(45);
  });
});
