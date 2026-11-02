import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ICS_MAX_BLOCKS,
  ICS_MAX_BYTES,
  ICS_MAX_EVENTS,
  type ImportedBlock,
  type IcsPreview,
  parseIcs,
} from "../ics";
import { eachDay } from "@/lib/scheduling/time";
import { type BlockSpec, occursOn, validateBlockForm } from "@/lib/scheduling/weeklyBlocks";

const FIXTURE = readFileSync(join(__dirname, "fixtures/horaire-hiver-2027.ics"), "utf8");
const TODAY = "2026-11-02";
const B201 = "Cégep Montmorency, local B-201";

function preview(text: string, today = TODAY): IcsPreview {
  const r = parseIcs(text, { today });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Petit calendrier avec les événements donnés (lignes VEVENT sans BEGIN/END). */
function ics(...events: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//FR",
    ...events.flatMap((e, i) => ["BEGIN:VEVENT", `UID:e${i}@test`, ...e, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Résumé lisible d'un bloc : « lun. 2027-01-18→2027-02-22 10:00-12:00 Titre ». */
function sum(b: ImportedBlock): string {
  const hh = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const when = b.weekday == null ? b.validFrom : `j${b.weekday} ${b.validFrom}→${b.validUntil}`;
  return `${when} ${hh(b.startMinute)}-${hh(b.endMinute)} ${b.title}`;
}

const asSpec = (b: ImportedBlock): BlockSpec => ({ ...b, placeId: null });

describe("parseIcs : fichier d'exemple (session d'hiver 2027 avec semaine de relâche)", () => {
  const p = preview(FIXTURE);

  it("détecte les cours hebdomadaires, coupés autour de la relâche, et les ponctuels", () => {
    expect(p.blocks.map(sum)).toEqual([
      "j1 2027-01-18→2027-02-22 10:00-12:00 Chimie générale",
      "j1 2027-03-08→2027-05-10 10:00-12:00 Chimie générale",
      "j2 2027-01-19→2027-02-23 13:00-15:00 Philosophie et rationalité",
      "j2 2027-03-09→2027-04-27 13:00-15:00 Philosophie et rationalité",
      "j3 2027-01-20→2027-02-24 10:00-12:00 Chimie générale",
      "j3 2027-03-10→2027-03-31 10:00-12:00 Chimie générale",
      "j3 2027-04-14→2027-05-12 10:00-12:00 Chimie générale",
      "j4 2027-01-21→2027-02-25 08:00-10:00 Éducation physique",
      "j4 2027-03-11→2027-05-13 08:00-10:00 Éducation physique",
      "j6 2027-01-23→2027-10-30 10:00-16:00 Travail au café",
      "2027-03-24 14:00-16:00 Examen de mi-session : chimie",
      "2027-04-07 13:00-15:00 Chimie générale",
      "2027-05-18 09:00-12:00 Examen final : chimie",
    ]);
    expect(p.eventCount).toBe(9);
  });

  it("aucun bloc n'a lieu pendant la semaine de relâche (EXDATE)", () => {
    for (const day of eachDay("2027-03-01", "2027-03-05")) {
      expect(p.blocks.filter((b) => occursOn(asSpec(b), day))).toEqual([]);
    }
  });

  it("chaque occurrence du fichier est représentée exactement une fois", () => {
    // Chimie du lundi : 18 janv. → 10 mai, sauf le 1er mars = 16 lundis.
    const mondays = eachDay("2027-01-18", "2027-05-14").filter((d) =>
      p.blocks.some(
        (b) => b.title === "Chimie générale" && b.weekday === 1 && occursOn(asSpec(b), d),
      ),
    );
    expect(mondays).toHaveLength(16);
    expect(mondays).not.toContain("2027-03-01");
    // COUNT=15 compte aussi l'occurrence exclue : 14 cours de philo, le dernier le 27 avril.
    const philo = p.blocks.filter((b) => b.title.startsWith("Philosophie"));
    expect(philo.reduce((n, b) => n + b.occurrences, 0)).toBe(14);
  });

  it("une occurrence déplacée (RECURRENCE-ID) remplace l'originale", () => {
    const wed = p.blocks.filter((b) => b.title === "Chimie générale" && b.weekday === 3);
    expect(wed.some((b) => occursOn(asSpec(b), "2027-04-07"))).toBe(false);
    const moved = p.blocks.find((b) => b.weekday == null && b.validFrom === "2027-04-07");
    expect(moved).toMatchObject({ startMinute: 13 * 60, endMinute: 15 * 60 });
  });

  it("garde l'heure locale après le changement d'heure du 14 mars (TZID America/Toronto)", () => {
    const monday = p.blocks.find((b) => b.weekday === 1 && b.validFrom === "2027-03-08");
    expect(monday).toMatchObject({ startMinute: 600, endMinute: 720, validUntil: "2027-05-10" });
  });

  it("convertit une heure en UTC (Z) en heure locale", () => {
    // 18 h Z le 24 mars (heure avancée, UTC−4) = 14 h.
    const exam = p.blocks.find((b) => b.title.startsWith("Examen de mi-session"));
    expect(exam).toMatchObject({ weekday: null, startMinute: 14 * 60, endMinute: 16 * 60 });
  });

  it("lit les lieux (virgule échappée) et les liste du plus fréquent au moins fréquent", () => {
    expect(p.locations).toEqual([
      B201,
      "Cégep Montmorency, gymnase",
      "Cégep Montmorency, local A-110",
      "Café Le Grain, Laval",
    ]);
    expect(p.blocks[0].locationText).toBe(B201);
  });

  it("ignore la journée entière de relâche et l'événement annulé, avec une remarque", () => {
    expect(p.blocks.some((b) => b.title.includes("relâche"))).toBe(false);
    expect(p.blocks.some((b) => b.title.includes("annulé"))).toBe(false);
    expect(p.warnings).toEqual([
      "1 événement d'une journée entière ignoré (congés, rappels…).",
      "1 événement annulé ignoré.",
    ]);
  });

  it("une répétition sans fin s'arrête à un an d'aujourd'hui", () => {
    const job = p.blocks.find((b) => b.title === "Travail au café");
    expect(p.window).toEqual({ from: TODAY, to: "2027-11-01" });
    expect(job?.validUntil).toBe("2027-10-30");
  });

  it("tous les blocs respectent les règles du formulaire et de la BD (migration 0005)", () => {
    for (const b of p.blocks) {
      const v = validateBlockForm({
        title: b.title,
        placeId: null,
        start: `${String(Math.floor(b.startMinute / 60)).padStart(2, "0")}:${String(b.startMinute % 60).padStart(2, "0")}`,
        end: `${String(Math.floor(b.endMinute / 60)).padStart(2, "0")}:${String(b.endMinute % 60).padStart(2, "0")}`,
        kind: b.weekday == null ? "once" : "weekly",
        weekdays: b.weekday == null ? [] : [b.weekday],
        date: b.validFrom,
        sessionStart: b.validFrom,
        sessionEnd: b.validUntil,
      });
      expect(v.ok, sum(b)).toBe(true);
    }
  });

  it("donne le même résultat avec des fins de ligne Unix ou Windows (ré-import identique)", () => {
    const crlf = preview(FIXTURE.replace(/\r?\n/g, "\r\n"));
    expect(crlf.blocks).toEqual(p.blocks);
    expect(new Set(p.blocks.map((b) => b.key)).size).toBe(p.blocks.length);
  });

  it("ignore les occurrences déjà passées", () => {
    const later = preview(FIXTURE, "2027-04-01");
    expect(later.blocks.map(sum).slice(0, 2)).toEqual([
      "j1 2027-04-05→2027-05-10 10:00-12:00 Chimie générale",
      "j2 2027-04-06→2027-04-27 13:00-15:00 Philosophie et rationalité",
    ]);
    expect(later.warnings).toContain(
      "Les occurrences passées ou dans plus d'un an ne sont pas importées.",
    );
  });
});

describe("parseIcs : récurrences", () => {
  it("horaire écrit en UTC (Z) : l'heure locale change avec l'heure avancée", () => {
    // 13 h Z = 8 h HNE, puis 9 h HAE après le 14 mars 2027.
    const p = preview(
      ics([
        "SUMMARY:Éduc",
        "DTSTART:20270304T130000Z",
        "DTEND:20270304T150000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20270325T235959Z",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual([
      "j4 2027-03-04→2027-03-11 08:00-10:00 Éduc",
      "j4 2027-03-18→2027-03-25 09:00-11:00 Éduc",
    ]);
  });

  it("changement d'heure de l'automne avec TZID : 10 h reste 10 h", () => {
    const p = preview(
      ics([
        "SUMMARY:Cours",
        "DTSTART;TZID=America/Toronto:20261102T100000",
        "DTEND;TZID=America/Toronto:20261102T113000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
      ]),
    );
    // Le 1er novembre 2026 est le changement d'heure : les trois lundis sont après, mais on
    // vérifie aussi qu'une série traversant le changement reste un seul bloc.
    expect(p.blocks.map(sum)).toEqual(["j1 2026-11-02→2026-11-16 10:00-11:30 Cours"]);
    const across = preview(
      ics([
        "SUMMARY:Cours",
        "DTSTART;TZID=America/Toronto:20261026T100000",
        "DTEND;TZID=America/Toronto:20261026T113000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
      ]),
      "2026-10-01",
    );
    expect(across.blocks.map(sum)).toEqual(["j1 2026-10-26→2026-11-09 10:00-11:30 Cours"]);
  });

  it("BYDAY à plusieurs jours, UNTIL en date seule (jour inclus)", () => {
    const p = preview(
      ics([
        "SUMMARY:Maths",
        "DTSTART;TZID=America/Toronto:20270118T080000",
        "DTEND;TZID=America/Toronto:20270118T094500",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270128",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual([
      "j1 2027-01-18→2027-01-25 08:00-09:45 Maths",
      "j4 2027-01-21→2027-01-28 08:00-09:45 Maths",
    ]);
  });

  it("COUNT avec EXDATE en UTC sur un événement en TZID", () => {
    const p = preview(
      ics([
        "SUMMARY:Labo",
        "DTSTART;TZID=America/Toronto:20270119T140000",
        "DTEND;TZID=America/Toronto:20270119T170000",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        // 14 h HNE le 26 janvier = 19 h Z.
        "EXDATE:20270126T190000Z",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual([
      "j2 2027-02-02→2027-02-09 14:00-17:00 Labo",
      "2027-01-19 14:00-17:00 Labo",
    ]);
  });

  it("INTERVAL=2 : une semaine sur deux devient des blocs ponctuels exacts", () => {
    const p = preview(
      ics([
        "SUMMARY:Stage",
        "DTSTART;TZID=America/Toronto:20270105T090000",
        "DTEND;TZID=America/Toronto:20270105T120000",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual([
      "2027-01-05 09:00-12:00 Stage",
      "2027-01-19 09:00-12:00 Stage",
      "2027-02-02 09:00-12:00 Stage",
    ]);
  });

  it("DAILY avec BYDAY (lundi au vendredi)", () => {
    const p = preview(
      ics([
        "SUMMARY:Camp",
        "DTSTART;TZID=America/Toronto:20270705T090000",
        "DURATION:PT2H",
        "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20270716T235959Z",
      ]),
    );
    expect(p.blocks).toHaveLength(5);
    expect(p.blocks.every((b) => b.occurrences === 2 && b.endMinute === 11 * 60)).toBe(true);
  });

  it("répétition sans fin : un seul bloc limité à la fenêtre d'un an (période < 366 jours)", () => {
    const p = parseIcs(
      ics([
        "SUMMARY:Hebdo",
        "DTSTART;TZID=America/Toronto:20261102T180000",
        "DTEND;TZID=America/Toronto:20261102T190000",
        "RRULE:FREQ=WEEKLY",
      ]),
      { today: TODAY },
    );
    if (!r(p)) return;
    expect(p.value.blocks).toHaveLength(1);
    expect(p.value.blocks[0]).toMatchObject({ validFrom: "2026-11-02", validUntil: "2027-11-01" });
  });

  it("règle non prise en charge (impossible) : ignorée avec une remarque, sans boucle infinie", () => {
    const p = preview(
      ics(
        [
          "SUMMARY:Bizarre",
          "DTSTART;TZID=America/Toronto:20270101T090000",
          "DTEND;TZID=America/Toronto:20270101T100000",
          "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
        ],
        [
          "SUMMARY:Ok",
          "DTSTART;TZID=America/Toronto:20270101T090000",
          "DTEND;TZID=America/Toronto:20270101T100000",
        ],
      ),
    );
    expect(p.blocks.map((b) => b.title)).toEqual(["Ok"]);
    expect(p.warnings[0]).toMatch(/règle de répétition non prise en charge/);
  });
});

describe("parseIcs : fuseaux et heures", () => {
  it("heure « flottante » (sans TZID) : heure du Québec", () => {
    const p = preview(ics(["SUMMARY:A", "DTSTART:20270301T093000", "DTEND:20270301T110000"]));
    expect(p.blocks.map(sum)).toEqual(["2027-03-01 09:30-11:00 A"]);
  });

  it("autre fuseau IANA : converti en heure du Québec", () => {
    const p = preview(
      ics([
        "SUMMARY:Appel",
        "DTSTART;TZID=Europe/Paris:20270301T150000",
        "DTEND;TZID=Europe/Paris:20270301T160000",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual(["2027-03-01 09:00-10:00 Appel"]);
  });

  it("noms Outlook et préfixe Mozilla reconnus ; TZID inconnu signalé", () => {
    const p = preview(
      ics(
        [
          "SUMMARY:Outlook",
          'DTSTART;TZID="Eastern Standard Time":20270301T090000',
          'DTEND;TZID="Eastern Standard Time":20270301T100000',
        ],
        [
          "SUMMARY:Mozilla",
          "DTSTART;TZID=/mozilla.org/20050126_1/Europe/Paris:20270302T160000",
          "DTEND;TZID=/mozilla.org/20050126_1/Europe/Paris:20270302T170000",
        ],
        ["SUMMARY:Inconnu", "DTSTART;TZID=Ma zone:20270303T090000", "DURATION:PT1H"],
      ),
    );
    expect(p.blocks.map(sum)).toEqual([
      "2027-03-01 09:00-10:00 Outlook",
      "2027-03-02 10:00-11:00 Mozilla",
      "2027-03-03 09:00-10:00 Inconnu",
    ]);
    expect(p.warnings).toEqual([
      "Fuseau horaire inconnu (« Ma zone ») : heures lues comme celles du Québec.",
    ]);
  });

  it("un événement de nuit est coupé à minuit en deux blocs", () => {
    const p = preview(
      ics([
        "SUMMARY:Quart de nuit",
        "DTSTART;TZID=America/Toronto:20270305T220000",
        "DTEND;TZID=America/Toronto:20270306T060000",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual([
      "2027-03-05 22:00-24:00 Quart de nuit",
      "2027-03-06 00:00-06:00 Quart de nuit",
    ]);
  });

  it("nuit du changement d'heure (2 h → 3 h) : durée réelle respectée", () => {
    // 1 h HNE → 4 h HAE le 14 mars 2027 (2 h réelles) : le bloc va de 1 h à 4 h, heure locale.
    const p = preview(
      ics([
        "SUMMARY:Nuit",
        "DTSTART;TZID=America/Toronto:20270314T010000",
        "DTEND;TZID=America/Toronto:20270314T040000",
      ]),
    );
    expect(p.blocks.map(sum)).toEqual(["2027-03-14 01:00-04:00 Nuit"]);
  });
});

describe("parseIcs : limites et fichiers invalides", () => {
  it("refuse un fichier de plus de 1 Mo", () => {
    const big = ics(["SUMMARY:A", "DTSTART:20270301T090000", "DURATION:PT1H"]).replace(
      "PRODID",
      `X-PAD:${"a".repeat(ICS_MAX_BYTES)}\r\nPRODID`,
    );
    expect(parseIcs(big, { today: TODAY })).toEqual({
      ok: false,
      error: "Le fichier est trop gros (1 Mo au maximum).",
    });
  });

  it("refuse un fichier qui n'est pas un calendrier, ou illisible, ou vide", () => {
    expect(parseIcs("bonjour", { today: TODAY })).toMatchObject({ ok: false });
    expect(parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n", { today: TODAY })).toMatchObject({
      ok: false,
      error: "Ce fichier .ics est illisible (format invalide).",
    });
    expect(parseIcs(ics(), { today: TODAY })).toEqual({
      ok: false,
      error: "Aucun événement trouvé dans ce fichier.",
    });
  });

  it("refuse un fichier avec trop d'événements", () => {
    const many = Array.from({ length: ICS_MAX_EVENTS + 1 }, () => [
      "SUMMARY:A",
      "DTSTART:20270301T090000",
      "DURATION:PT1H",
    ]);
    const r = parseIcs(ics(...many), { today: TODAY });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/trop d'événements/);
  });

  it("refuse un fichier qui donnerait plus de 300 blocs", () => {
    const many = Array.from({ length: ICS_MAX_BLOCKS + 1 }, (_, i) => {
      const day = new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10).replace(/-/g, "");
      return [`SUMMARY:A${i}`, `DTSTART:${day}T090000`, "DURATION:PT1H"];
    });
    const r = parseIcs(ics(...many), { today: TODAY });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/301 blocs/);
  });

  it("titre de plus de 100 caractères : raccourci avec « … » et signalé", () => {
    const p = preview(
      ics([`SUMMARY:${"Très long cours ".repeat(10)}`, "DTSTART:20270301T090000", "DURATION:PT1H"]),
    );
    expect(p.blocks[0].title).toHaveLength(100);
    expect(p.blocks[0].title.endsWith("…")).toBe(true);
    expect(p.blocks[0].titleTruncated).toBe(true);
    expect(p.warnings).toContain("1 titre raccourci à 100 caractères.");
  });

  it("caractères de contrôle et titre vide nettoyés", () => {
    const p = preview(
      ics(
        ["SUMMARY:Chimie\\nlabo", "DTSTART:20270301T090000", "DURATION:PT1H"],
        ["DTSTART:20270302T090000", "DURATION:PT1H"],
      ),
    );
    expect(p.blocks.map((b) => b.title)).toEqual(["Chimie labo", "Sans titre"]);
  });

  it("événement sans fin ou de plus de 7 jours : ignoré avec une remarque", () => {
    const p = preview(
      ics(
        ["SUMMARY:Sans fin", "DTSTART:20270301T090000"],
        ["SUMMARY:Long", "DTSTART:20270301T090000", "DTEND:20270310T090000"],
      ),
    );
    expect(p.blocks).toEqual([]);
    expect(p.warnings).toEqual([
      "1 événement sans heure de fin ignoré.",
      "1 événement de plus de 7 jours ignoré.",
    ]);
  });
});

function r<T extends { ok: boolean }>(x: T): x is T & { ok: true } {
  expect(x.ok).toBe(true);
  return x.ok;
}
