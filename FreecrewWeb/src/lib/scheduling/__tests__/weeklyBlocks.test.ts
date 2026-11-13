import { describe, expect, it } from "vitest";

import {
  type BlockSpec,
  blocksOnDay,
  blocksOverlap,
  daysBetween,
  findOverlaps,
  formatClock,
  formatClockFr,
  occurrencesIn,
  occursOn,
  parseClock,
  repeatLabel,
  shareADay,
  suggestSession,
  validateBlockForm,
  validateBlockId,
  weekDays,
  weekStart,
  weekdayOf,
} from "../weeklyBlocks";

/** Session d'automne 2025 (du lundi 25 août au vendredi 19 décembre). */
const AUTOMNE = { validFrom: "2025-08-25", validUntil: "2025-12-19" };

function bloc(partial: Partial<BlockSpec>): BlockSpec {
  return {
    id: "b",
    title: "Chimie",
    placeId: null,
    startMinute: 10 * 60,
    endMinute: 12 * 60,
    weekday: 1,
    ...AUTOMNE,
    ...partial,
  };
}

const PLACE = "00000000-0000-4000-8000-0000000000aa";

function form(partial: Record<string, unknown> = {}) {
  return {
    title: "Chimie générale",
    placeId: PLACE,
    start: "10:00",
    end: "11:45",
    kind: "weekly",
    weekdays: [1, 3],
    date: "",
    sessionStart: "2025-08-25",
    sessionEnd: "2025-12-19",
    ...partial,
  };
}

describe("heures", () => {
  it("parseClock / formatClock : 00:00 à 24:00", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("10:15")).toBe(615);
    expect(parseClock("24:00")).toBe(1440);
    expect(parseClock("24:15")).toBeNull();
    expect(parseClock("9:00")).toBeNull();
    expect(parseClock("10:60")).toBeNull();
    expect(formatClock(615)).toBe("10:15");
    expect(formatClock(1440)).toBe("24:00");
    expect(() => formatClock(1441)).toThrow();
    expect(() => formatClock(10.5)).toThrow();
  });

  it("formatClockFr écrit l'heure à la québécoise", () => {
    expect(formatClockFr(9 * 60)).toBe("9 h");
    expect(formatClockFr(10 * 60 + 5)).toBe("10 h 05");
    expect(formatClockFr(1440)).toBe("minuit");
  });
});

describe("semaines", () => {
  it("weekStart donne le lundi, même le dimanche et le jour du changement d'heure", () => {
    expect(weekStart("2025-11-02")).toBe("2025-10-27"); // dimanche, fin de l'heure avancée
    expect(weekStart("2025-11-03")).toBe("2025-11-03");
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // change d'année
    expect(weekdayOf("2025-11-02")).toBe(7);
  });

  it("weekDays : 7 jours du lundi au dimanche, et refuse un autre jour qu'un lundi", () => {
    expect(weekDays("2025-03-03")).toEqual([
      "2025-03-03",
      "2025-03-04",
      "2025-03-05",
      "2025-03-06",
      "2025-03-07",
      "2025-03-08",
      "2025-03-09", // passage à l'heure avancée : le jour existe une seule fois
    ]);
    expect(() => weekDays("2025-03-04")).toThrow(/lundi/);
  });

  it("daysBetween compte des jours calendaires (pas des tranches de 24 h)", () => {
    expect(daysBetween("2025-03-08", "2025-03-10")).toBe(2);
    expect(daysBetween("2025-11-01", "2025-11-03")).toBe(2);
    expect(daysBetween("2025-12-19", "2025-08-25")).toBe(-116);
  });
});

describe("récurrence hebdomadaire", () => {
  it("un bloc du lundi apparaît chaque lundi de la session, bornes incluses, et pas après", () => {
    const b = bloc({});
    const lundis = occurrencesIn(b, { from: "2025-08-01", to: "2026-01-31" });
    expect(lundis[0]).toBe("2025-08-25");
    expect(lundis.at(-1)).toBe("2025-12-15");
    expect(lundis).toHaveLength(17);
    expect(occursOn(b, "2025-12-22")).toBe(false); // lundi après la session
    expect(occursOn(b, "2025-08-18")).toBe(false); // lundi avant
    expect(occursOn(b, "2025-08-26")).toBe(false); // mardi
  });

  it("la semaine du changement d'heure n'enlève ni ne décale aucun cours", () => {
    const dimanche = bloc({ weekday: 7, startMinute: 9 * 60, endMinute: 10 * 60 });
    expect(occursOn(dimanche, "2025-11-02")).toBe(true);
    expect(occursOn(dimanche, "2025-03-09")).toBe(false); // hors session d'automne
    const hiver = bloc({ weekday: 7, validFrom: "2025-01-20", validUntil: "2025-05-20" });
    expect(occursOn(hiver, "2025-03-09")).toBe(true);
  });

  it("bloc ponctuel : seulement son jour", () => {
    const exam = bloc({ weekday: null, validFrom: "2025-10-14", validUntil: "2025-10-14" });
    expect(occurrencesIn(exam, { from: "2025-10-01", to: "2025-10-31" })).toEqual(["2025-10-14"]);
  });

  it("bloc sans bornes : toutes les semaines", () => {
    const job = bloc({ weekday: 6, validFrom: null, validUntil: null });
    expect(occursOn(job, "1999-01-02")).toBe(true);
    expect(occursOn(job, "2040-01-07")).toBe(true);
  });

  it("blocksOnDay trie par heure", () => {
    const tot = bloc({ id: "tot", startMinute: 8 * 60, endMinute: 9 * 60 });
    const tard = bloc({ id: "tard", startMinute: 13 * 60, endMinute: 15 * 60 });
    const mardi = bloc({ id: "mardi", weekday: 2 });
    expect(blocksOnDay([tard, mardi, tot], "2025-09-15").map((b) => b.id)).toEqual(["tot", "tard"]);
  });
});

describe("chevauchements", () => {
  it("même jour, heures qui se croisent : chevauchement ; blocs collés : non", () => {
    const a = bloc({ id: "a" });
    expect(blocksOverlap(a, bloc({ id: "b", startMinute: 11 * 60, endMinute: 13 * 60 }))).toBe(
      true,
    );
    expect(blocksOverlap(a, bloc({ id: "b", startMinute: 12 * 60, endMinute: 13 * 60 }))).toBe(
      false,
    );
    expect(blocksOverlap(a, bloc({ id: "b", weekday: 2 }))).toBe(false);
  });

  it("sessions disjointes : pas de chevauchement, même jour et mêmes heures", () => {
    const hiver = bloc({ id: "h", validFrom: "2026-01-20", validUntil: "2026-05-20" });
    expect(blocksOverlap(bloc({}), hiver)).toBe(false);
  });

  it("sessions qui se croisent sans contenir ce jour de semaine : pas de chevauchement", () => {
    // Croisement du mardi 16 au mercredi 17 décembre seulement : aucun lundi en commun.
    const a = bloc({ id: "a", validFrom: "2025-09-01", validUntil: "2025-12-17" });
    const b = bloc({ id: "b", validFrom: "2025-12-16", validUntil: "2026-03-01" });
    expect(shareADay(a, b)).toBe(false);
    const c = bloc({ id: "c", validFrom: "2025-12-15", validUntil: "2026-03-01" });
    expect(shareADay(a, c)).toBe(true);
  });

  it("ponctuel pendant un cours hebdomadaire de la session : chevauchement", () => {
    const exam = bloc({
      id: "exam",
      weekday: null,
      validFrom: "2025-10-13", // un lundi
      validUntil: "2025-10-13",
      startMinute: 11 * 60,
      endMinute: 14 * 60,
    });
    expect(blocksOverlap(bloc({}), exam)).toBe(true);
    expect(blocksOverlap(exam, bloc({}))).toBe(true);
    expect(blocksOverlap(exam, { ...exam, id: "x", validFrom: "2025-10-14" })).toBe(false);
  });

  it("findOverlaps ignore le bloc modifié lui-même", () => {
    const existants = [
      bloc({ id: "a" }),
      bloc({ id: "b", startMinute: 11 * 60 }),
      bloc({ id: "c", weekday: 3 }),
    ];
    const modif = { ...existants[0], startMinute: 9 * 60 };
    expect(findOverlaps(modif, existants).map((b) => b.id)).toEqual(["b"]);
    const nouveau: BlockSpec = { ...modif, id: undefined };
    expect(findOverlaps(nouveau, existants).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("un côté sans borne : chevauche si même jour", () => {
    const toujours = bloc({ id: "t", validFrom: null, validUntil: null });
    const finAvant = bloc({ id: "f", validFrom: null, validUntil: "2025-09-03" });
    expect(blocksOverlap(toujours, bloc({}))).toBe(true);
    expect(blocksOverlap(finAvant, bloc({}))).toBe(true);
  });
});

describe("suggestSession", () => {
  it("reprend la session la plus fréquente de mes cours en cours", () => {
    const blocs = [
      bloc({ id: "1" }),
      bloc({ id: "2", weekday: 3 }),
      bloc({ id: "3", validFrom: "2025-09-01", validUntil: "2025-10-01" }),
    ];
    expect(suggestSession(blocs, "2025-09-10")).toEqual({ from: "2025-08-25", to: "2025-12-19" });
  });

  it("ignore les sessions finies et les ponctuels ; sinon devine la session de cégep", () => {
    const fini = bloc({ validFrom: "2025-01-20", validUntil: "2025-05-20" });
    const ponctuel = bloc({ weekday: null, validFrom: "2025-10-01", validUntil: "2025-10-01" });
    // Pendant la session d'automne : à partir du lundi de cette semaine jusqu'au 20 décembre.
    expect(suggestSession([fini, ponctuel], "2025-10-01")).toEqual({
      from: "2025-09-29",
      to: "2025-12-20",
    });
    // Pendant le congé des fêtes : la session d'hiver qui vient.
    expect(suggestSession([], "2025-12-27")).toEqual({ from: "2026-01-20", to: "2026-05-20" });
    expect(suggestSession([], "2026-01-05")).toEqual({ from: "2026-01-20", to: "2026-05-20" });
    expect(suggestSession([], "2026-06-01")).toEqual({ from: "2026-06-01", to: "2026-08-20" });
  });

  // Régression : un cours du lundi saisi un mardi n'apparaissait pas le lundi de la semaine
  // affichée (la session commençait « aujourd'hui », le mardi).
  it("un cours du lundi saisi un mardi paraît dès le lundi de la semaine en cours", () => {
    const mardi = "2026-11-03";
    const lundi = "2026-11-02";
    const session = suggestSession([], mardi);
    expect(session.from).toBe(lundi);
    const coursDuLundi = bloc({ weekday: 1, validFrom: session.from, validUntil: session.to });
    expect(occursOn(coursDuLundi, lundi)).toBe(true);
    expect(blocksOnDay([coursDuLundi], lundi)).toHaveLength(1);
  });

  it("ramène au lundi une session déjà commencée un autre jour de la semaine en cours", () => {
    // Blocs saisis le mardi avant le correctif : session du 3 novembre.
    const dejaSaisis = [
      bloc({ id: "1", weekday: 2, validFrom: "2026-11-03", validUntil: "2026-12-20" }),
      bloc({ id: "2", weekday: 4, validFrom: "2026-11-03", validUntil: "2026-12-20" }),
    ];
    expect(suggestSession(dejaSaisis, "2026-11-04")).toEqual({
      from: "2026-11-02",
      to: "2026-12-20",
    });
    // Une session qui commence une autre semaine n'est pas touchée.
    expect(suggestSession(dejaSaisis, "2026-11-10")).toEqual({
      from: "2026-11-03",
      to: "2026-12-20",
    });
  });
});

describe("validateBlockForm", () => {
  it("un cours hebdomadaire sur deux jours donne deux blocs", () => {
    const r = validateBlockForm(form());
    expect(r).toEqual({
      ok: true,
      value: [1, 3].map((weekday) => ({
        title: "Chimie générale",
        placeId: PLACE,
        startMinute: 600,
        endMinute: 705,
        weekday,
        validFrom: "2025-08-25",
        validUntil: "2025-12-19",
      })),
    });
  });

  it("nettoie le titre, accepte « aucun lieu » (maison) et un bloc jusqu'à minuit", () => {
    const r = validateBlockForm(
      form({
        title: "  Travail \n au  dépanneur ",
        placeId: "",
        end: "24:00",
        start: "18:00",
        weekdays: [5],
      }),
    );
    expect(r.ok && r.value[0]).toMatchObject({
      title: "Travail au dépanneur",
      placeId: null,
      endMinute: 1440,
    });
  });

  it("bloc ponctuel : un jour, et valid_until = valid_from", () => {
    const r = validateBlockForm(form({ kind: "once", date: "2025-11-02", weekdays: [] }));
    expect(r).toMatchObject({
      ok: true,
      value: [{ weekday: null, validFrom: "2025-11-02", validUntil: "2025-11-02" }],
    });
  });

  it.each([
    [{ title: "   " }, /titre/],
    [{ title: "x".repeat(101) }, /trop long/],
    [{ title: "a\u0007b" }, /caractères invalides/],
    [{ placeId: "pas-un-uuid" }, /Lieu introuvable/],
    [{ start: "11:00", end: "10:00" }, /après le début/],
    [{ start: "10:00", end: "10:00" }, /après le début/],
    [{ start: "24:00", end: "24:00" }, /début invalide/],
    [{ start: "25:00" }, /Heure invalide/],
    [{ weekdays: [] }, /au moins un jour/],
    [{ weekdays: [0] }, /Jour de la semaine invalide/],
    [{ weekdays: ["1"] }, /Jour de la semaine invalide/],
    [{ sessionStart: "" }, /début et la fin de la session/],
    [{ sessionEnd: "2025-02-30" }, /début et la fin de la session/],
    [{ sessionStart: "2025-12-19", sessionEnd: "2025-08-25" }, /après son début/],
    [{ sessionEnd: "2026-08-26" }, /plus d'un an/],
    [
      { weekdays: [6], sessionStart: "2025-09-01", sessionEnd: "2025-09-05" },
      /ne tombe dans la session/,
    ],
    [{ kind: "once", date: "" }, /jour du bloc/],
    [{ kind: "autre" }, /Type de bloc/],
  ])("refuse %o", (partial, erreur) => {
    const r = validateBlockForm(form(partial));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(erreur);
  });

  it("refuse ce qui n'est pas un objet, et plusieurs jours pour une modification", () => {
    expect(validateBlockForm(null).ok).toBe(false);
    expect(validateBlockForm(form(), { single: true })).toMatchObject({ ok: false });
    expect(validateBlockForm(form({ weekdays: [2] }), { single: true }).ok).toBe(true);
  });

  it("validateBlockId", () => {
    expect(validateBlockId(PLACE.toUpperCase())).toEqual({ ok: true, value: PLACE });
    expect(validateBlockId("1; drop table")).toMatchObject({ ok: false });
  });
});

// ─── Story 2 : répétition personnalisée ────────────────────────────────────────────────────

describe("répétition personnalisée (tous les X jours / semaines / mois / ans)", () => {
  const form = (partial: Record<string, unknown>) => ({
    title: "Club",
    placeId: null,
    start: "18:00",
    end: "20:00",
    kind: "custom",
    weekdays: [2],
    date: "2026-11-05",
    sessionStart: "2026-11-05",
    sessionEnd: "",
    repeatEvery: "2",
    repeatUnit: "week",
    repeatEnd: "never",
    repeatCount: "10",
    ...partial,
  });

  it("refuse 0, un nombre négatif, vide, décimal ou plus de 99, sans rien créer", () => {
    for (const repeatEvery of ["0", "-1", "", "  ", "2.5", "100", "abc", 0, -3]) {
      const r = validateBlockForm(form({ repeatEvery }));
      expect(r.ok, String(repeatEvery)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/1 à 99/);
    }
    expect(validateBlockForm(form({ repeatEvery: "99" })).ok).toBe(true);
  });

  it("refuse une unité inconnue, une date de début manquante, aucun jour en semaines", () => {
    expect(validateBlockForm(form({ repeatUnit: "siècle" })).ok).toBe(false);
    expect(validateBlockForm(form({ sessionStart: "" })).ok).toBe(false);
    expect(validateBlockForm(form({ weekdays: [] })).ok).toBe(false);
    // Les jours cochés ne servent pas pour les mois.
    expect(validateBlockForm(form({ repeatUnit: "month", weekdays: [] })).ok).toBe(true);
  });

  it("toutes les 2 semaines le mardi et le jeudi, sans fin : un bloc par jour, même ancrage", () => {
    const r = validateBlockForm(form({ weekdays: [4, 2] }));
    expect(r.ok && r.value).toEqual([
      expect.objectContaining({
        weekday: 2,
        validFrom: "2026-11-05",
        validUntil: null,
        repeatUnit: "week",
        repeatEvery: 2,
      }),
      expect.objectContaining({ weekday: 4, validFrom: "2026-11-05", repeatEvery: 2 }),
    ]);
    if (!r.ok) return;
    const range = { from: "2026-11-01", to: "2026-11-30" };
    expect(r.value.flatMap((b) => occurrencesIn(b, range)).sort()).toEqual([
      "2026-11-05",
      "2026-11-17",
      "2026-11-19",
    ]);
  });

  it("tous les mois à partir du 31 : un seul bloc ponctuel répété, dernier jour des mois courts", () => {
    const r = validateBlockForm(
      form({ repeatUnit: "month", repeatEvery: 1, sessionStart: "2027-01-31" }),
    );
    expect(r.ok && r.value).toEqual([
      expect.objectContaining({ weekday: null, repeatUnit: "month", validFrom: "2027-01-31" }),
    ]);
    if (!r.ok) return;
    expect(occurrencesIn(r.value[0], { from: "2027-01-01", to: "2027-04-30" })).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("fin à une date : après le début, au plus 10 ans", () => {
    const ok = validateBlockForm(form({ repeatEnd: "date", sessionEnd: "2027-06-30" }));
    expect(ok.ok && ok.value[0].validUntil).toBe("2027-06-30");
    expect(validateBlockForm(form({ repeatEnd: "date", sessionEnd: "2026-11-01" })).ok).toBe(false);
    expect(validateBlockForm(form({ repeatEnd: "date", sessionEnd: "" })).ok).toBe(false);
    expect(validateBlockForm(form({ repeatEnd: "date", sessionEnd: "2037-01-01" })).ok).toBe(false);
    // Aucun jour coché ne tombe avant la fin : refusé.
    expect(
      validateBlockForm(form({ weekdays: [1], repeatEnd: "date", sessionEnd: "2026-11-07" })).ok,
    ).toBe(false);
  });

  it("fin après N fois : devient la date de la N-ième occurrence", () => {
    const r = validateBlockForm(form({ weekdays: [2, 4], repeatEnd: "count", repeatCount: "4" }));
    expect(r.ok && r.value.map((b) => b.validUntil)).toEqual(["2026-12-01", "2026-12-01"]);
    const mois = validateBlockForm(
      form({ repeatUnit: "month", repeatEvery: "3", repeatEnd: "count", repeatCount: 2 }),
    );
    expect(mois.ok && mois.value[0].validUntil).toBe("2027-02-05");
    for (const repeatCount of ["0", "", "1000", "-2"]) {
      expect(validateBlockForm(form({ repeatEnd: "count", repeatCount })).ok).toBe(false);
    }
    // Trop loin : 999 fois tous les 99 ans.
    expect(
      validateBlockForm(
        form({ repeatUnit: "year", repeatEvery: 99, repeatEnd: "count", repeatCount: 999 }),
      ).ok,
    ).toBe(false);
  });

  it("refuse une fin inconnue et, en modification, plusieurs jours", () => {
    expect(validateBlockForm(form({ repeatEnd: "parfois" })).ok).toBe(false);
    expect(validateBlockForm(form({ weekdays: [2, 4] }), { single: true }).ok).toBe(false);
  });

  it("les options « Chaque semaine » et « Une seule fois » restent comme avant", () => {
    const hebdo = validateBlockForm(
      form({ kind: "weekly", weekdays: [1], sessionStart: "2025-08-25", sessionEnd: "2025-12-19" }),
    );
    expect(hebdo.ok && hebdo.value[0].repeatUnit).toBeUndefined();
    const une = validateBlockForm(form({ kind: "once" }));
    expect(une.ok && une.value[0]).toMatchObject({ weekday: null, validFrom: "2026-11-05" });
  });

  it("occursOn et blocksOnDay : un bloc aux 2 semaines n'apparaît qu'une semaine sur deux", () => {
    const b = bloc({
      weekday: 2,
      validFrom: "2026-11-03",
      validUntil: null,
      repeatUnit: "week",
      repeatEvery: 2,
    });
    expect(occursOn(b, "2026-11-03")).toBe(true);
    expect(occursOn(b, "2026-11-10")).toBe(false);
    expect(occursOn(b, "2026-11-17")).toBe(true);
    expect(blocksOnDay([b], "2026-11-10")).toEqual([]);
  });

  it("chevauchements : tient compte de l'alternance et des mois", () => {
    const pair = bloc({
      id: "p",
      weekday: 2,
      validFrom: "2026-11-03",
      validUntil: null,
      repeatUnit: "week",
      repeatEvery: 2,
    });
    const impair = bloc({
      id: "i",
      weekday: 2,
      validFrom: "2026-11-10",
      validUntil: null,
      repeatUnit: "week",
      repeatEvery: 2,
    });
    expect(shareADay(pair, impair)).toBe(false);
    const hebdo = bloc({ id: "h", weekday: 2, ...AUTOMNE });
    expect(shareADay(pair, hebdo)).toBe(false); // l'automne 2025 est fini avant le début
    const hebdo2026 = bloc({
      id: "h2",
      weekday: 2,
      validFrom: "2026-11-01",
      validUntil: "2026-12-20",
    });
    expect(shareADay(pair, hebdo2026)).toBe(true);
    // Le 31 de chaque mois (dernier jour) et un ponctuel le 30 avril 2027.
    const mensuel = bloc({
      id: "m",
      weekday: null,
      validFrom: "2027-01-31",
      validUntil: null,
      repeatUnit: "month",
      repeatEvery: 1,
    });
    expect(
      shareADay(
        mensuel,
        bloc({ weekday: null, validFrom: "2027-04-30", validUntil: "2027-04-30" }),
      ),
    ).toBe(true);
    expect(
      shareADay(
        mensuel,
        bloc({ weekday: null, validFrom: "2027-04-29", validUntil: "2027-04-29" }),
      ),
    ).toBe(false);
    expect(findOverlaps({ ...pair, id: undefined }, [impair, hebdo2026])).toEqual([hebdo2026]);
  });

  it("suggestSession ignore les répétitions personnalisées", () => {
    const perso = bloc({
      weekday: 1,
      validFrom: "2026-11-02",
      validUntil: "2027-03-01",
      repeatUnit: "week",
      repeatEvery: 2,
    });
    expect(suggestSession([perso], "2026-11-05")).toEqual({ from: "2026-11-02", to: "2026-12-20" });
  });

  it("repeatLabel : en mots", () => {
    expect(repeatLabel(bloc({ weekday: 1, ...AUTOMNE }))).toBe("chaque semaine");
    expect(
      repeatLabel(
        bloc({ weekday: 1, validFrom: "2026-11-02", repeatUnit: "week", repeatEvery: 2 }),
      ),
    ).toBe("toutes les 2 semaines");
    expect(
      repeatLabel(bloc({ weekday: null, validFrom: "2026-11-05", validUntil: "2026-11-05" })),
    ).toBeNull();
  });
});
