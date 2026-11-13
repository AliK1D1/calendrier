/**
 * Import d'un horaire depuis un fichier calendrier `.ics` (Google Agenda, Outlook, Omnivox…).
 * Fonction pure : aucun accès BD ni React ; « aujourd'hui » est injecté.
 *
 * Étapes :
 * 1. Lecture du fichier avec ical.js (lignes repliées, échappements, paramètres).
 * 2. Dépliage de chaque événement en occurrences réelles : RRULE (DAILY/WEEKLY avec BYDAY,
 *    INTERVAL, UNTIL, COUNT ; MONTHLY/YEARLY simples), RDATE, EXDATE, et exceptions
 *    (RECURRENCE-ID : une occurrence déplacée ou annulée). La récurrence est calculée en
 *    heure murale du fuseau de l'événement (TZID), comme le veut la norme iCalendar : un
 *    cours à 10 h (TZID=America/Toronto) reste à 10 h après le changement d'heure. Un
 *    horaire écrit en UTC (« Z »), lui, se décale d'une heure en heure locale.
 * 3. Conversion de chaque occurrence en heures locales America/Toronto (un bloc ne traverse
 *    pas minuit : une occurrence de nuit est coupée en deux).
 * 4. Regroupement dans le modèle `busy_blocks` : les occurrences identiques (titre, lieu,
 *    jour de semaine, heures) qui se suivent **chaque semaine** deviennent un bloc
 *    hebdomadaire `weekday` + `validFrom`/`validUntil`. Une semaine manquante (semaine de
 *    relâche exclue par EXDATE) coupe la série en deux blocs : c'est la représentation exacte
 *    de l'ensemble des occurrences (un seul bloc couvrant la relâche la rendrait occupée).
 *    Une occurrence isolée devient un bloc ponctuel.
 *
 * Seules les occurrences d'aujourd'hui à dans un an (365 jours) sont gardées : la période
 * d'un bloc reste donc sous la limite de la BD (moins de 366 jours, migration 0005).
 */
import { formatInTimeZone } from "date-fns-tz";
import ICAL from "ical.js";

import { cleanText } from "@/lib/places/validation";
import { assertDay, MS_PER_MINUTE, TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import {
  BLOCK_TITLE_MAX,
  type BlockSpec,
  daysBetween,
  MINUTES_PER_DAY,
  shiftDay,
  weekdayOf,
} from "@/lib/scheduling/weeklyBlocks";

import {
  ICS_DEFAULT_HORIZON_DAYS,
  ICS_LOCATION_MAX,
  ICS_MAX_BLOCKS,
  ICS_MAX_BYTES,
  ICS_MAX_EVENTS,
  ICS_MAX_OCCURRENCES,
} from "./limits";

export {
  ICS_DEFAULT_HORIZON_DAYS,
  ICS_LOCATION_MAX,
  ICS_MAX_BLOCKS,
  ICS_MAX_BYTES,
  ICS_MAX_EVENTS,
  ICS_MAX_OCCURRENCES,
};

/** Itérations maximales de la règle de récurrence d'un événement. */
const MAX_ITERATIONS_PER_EVENT = 20_000;
/** Itérations maximales pour tout le fichier (protège le serveur d'un fichier piégé). */
const MAX_ITERATIONS_TOTAL = 300_000;
/**
 * Travail réel maximal pour tout le fichier : itérations de règles réellement calculées
 * (celles sautées d'un coup ne comptent pas) + valeurs RDATE/EXDATE. Sans cette limite, un
 * fichier de 1,4 Ko (15 événements « tous les jours depuis 1970 ») occupait le serveur 7 s.
 */
export const ICS_MAX_WORK = 20_000;
/**
 * Marge (jours) avant la fenêtre d'import : une occurrence qui commence plus tôt finit avant la
 * fenêtre (durée ≤ 7 jours, écart de fuseaux ≤ 1 jour). Inutile de la convertir en instant.
 */
const FAR_PAST_MARGIN_DAYS = 9;
/** Durée maximale d'une occurrence (au-delà : ignorée), en minutes. */
const MAX_EVENT_MINUTES = 7 * MINUTES_PER_DAY;

/** Un bloc détecté dans le fichier, prêt pour l'aperçu (lieu pas encore associé). */
export interface ImportedBlock extends Omit<
  BlockSpec,
  "id" | "placeId" | "validFrom" | "validUntil"
> {
  /** Clé stable dans l'aperçu. */
  key: string;
  /** Premier jour (hebdomadaire) ou jour (ponctuel). */
  validFrom: string;
  /** Dernier jour (hebdomadaire) ; égal à `validFrom` (ponctuel). */
  validUntil: string;
  /** Texte « LOCATION » du fichier (nettoyé), vide s'il n'y en a pas. */
  locationText: string;
  /** Nombre d'occurrences représentées par ce bloc. */
  occurrences: number;
  /** Vrai si le titre a été raccourci à 100 caractères. */
  titleTruncated: boolean;
}

export interface IcsPreview {
  blocks: ImportedBlock[];
  /** Lieux distincts du fichier (texte non vide), du plus fréquent au moins fréquent. */
  locations: string[];
  /** Remarques à afficher dans l'aperçu (éléments ignorés, titres raccourcis…). */
  warnings: string[];
  /** Plage de jours prise en compte. */
  window: { from: string; to: string };
  /** Nombre d'événements (VEVENT) lus. */
  eventCount: number;
}

export type IcsResult = { ok: true; value: IcsPreview } | { ok: false; error: string };

export interface IcsOptions {
  /** Aujourd'hui, `yyyy-MM-dd` (fuseau de l'app). Les occurrences passées sont ignorées. */
  today: string;
  /** Fenêtre en jours à partir d'aujourd'hui (défaut 365, au plus 365). */
  horizonDays?: number;
  /** Fuseau de l'app (défaut America/Toronto). */
  timeZone?: string;
  /**
   * Garder aussi les événements marqués « disponible » (TRANSP:TRANSPARENT). Calendriers
   * abonnés (story 3) : la personne choisit elle-même s'ils comptent comme occupés, et
   * beaucoup de calendriers publics (sports, fêtes) marquent tout « disponible ».
   */
  includeTransparent?: boolean;
}

/** Taille en octets d'un texte (UTF-8). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Lit un fichier `.ics` et en tire les blocs de l'horaire. Ne lance pas d'exception. */
export function parseIcs(text: string, options: IcsOptions): IcsResult {
  assertDay(options.today);
  const appZone = options.timeZone ?? TIME_ZONE;
  const horizon = Math.min(
    ICS_DEFAULT_HORIZON_DAYS,
    Math.max(1, Math.floor(options.horizonDays ?? ICS_DEFAULT_HORIZON_DAYS)),
  );
  const window = { from: options.today, to: shiftDay(options.today, horizon - 1) };

  if (byteLength(text) > ICS_MAX_BYTES) {
    return { ok: false, error: "Le fichier est trop gros (1 Mo au maximum)." };
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    return { ok: false, error: "Ce fichier n'est pas un calendrier .ics." };
  }

  let roots: InstanceType<typeof ICAL.Component>[];
  try {
    const jcal: unknown = ICAL.parse(text);
    // Un seul calendrier : [« vcalendar », …] ; plusieurs : [[« vcalendar », …], …].
    const list = Array.isArray(jcal) && Array.isArray(jcal[0]) ? jcal : [jcal];
    roots = list.map((j) => new ICAL.Component(j as unknown[]));
  } catch {
    return { ok: false, error: "Ce fichier .ics est illisible (format invalide)." };
  }

  const events = roots.flatMap((r) =>
    r.name === "vevent" ? [r] : r.getAllSubcomponents("vevent"),
  );
  if (events.length === 0) {
    return { ok: false, error: "Aucun événement trouvé dans ce fichier." };
  }
  if (events.length > ICS_MAX_EVENTS) {
    return {
      ok: false,
      error: `Le fichier contient trop d'événements (${events.length}, au plus ${ICS_MAX_EVENTS}). Exporte seulement l'horaire de la session.`,
    };
  }

  const ctx: Ctx = {
    appZone,
    window,
    windowStart: zonedTime(window.from, "00:00", appZone),
    windowEnd: zonedTime(window.to, "24:00", appZone),
    budget: MAX_ITERATIONS_TOTAL,
    work: ICS_MAX_WORK,
    farPastBefore: shiftDay(window.from, -FAR_PAST_MARGIN_DAYS),
    notes: new Notes(),
    includeTransparent: options.includeTransparent === true,
  };

  try {
    // Exceptions (RECURRENCE-ID) : elles remplacent une occurrence de l'événement principal.
    const overrides = new Map<string, Set<number>>();
    for (const ev of events) {
      const rid = ev.getFirstProperty("recurrence-id");
      const uid = textProp(ev, "uid");
      if (!rid || !uid) continue;
      const t = rid.getFirstValue();
      if (!(t instanceof ICAL.Time)) continue;
      const zone = resolveZone(paramOf(rid, "tzid"), t, appZone, ctx.notes);
      const set = overrides.get(uid) ?? new Set<number>();
      set.add(wallToInstant(t, zone).getTime());
      overrides.set(uid, set);
    }

    const pieces: Piece[] = [];
    for (const ev of events) {
      const isOverride = ev.getFirstProperty("recurrence-id") != null;
      const replaced = isOverride ? undefined : overrides.get(textProp(ev, "uid") ?? "");
      readEvent(ev, replaced, ctx, pieces);
      if (pieces.length > ICS_MAX_OCCURRENCES) {
        return {
          ok: false,
          error: `Le fichier contient trop d'occurrences d'ici un an (plus de ${ICS_MAX_OCCURRENCES}).`,
        };
      }
    }

    const blocks = groupPieces(pieces);
    if (blocks.length > ICS_MAX_BLOCKS) {
      return {
        ok: false,
        error: `Ce fichier donnerait ${blocks.length} blocs (au plus ${ICS_MAX_BLOCKS}). Exporte seulement l'horaire de la session.`,
      };
    }
    const truncated = blocks.filter((b) => b.titleTruncated).length;
    if (truncated > 0) {
      ctx.notes.add(
        `${truncated} titre${truncated > 1 ? "s" : ""} raccourci${truncated > 1 ? "s" : ""} à ${BLOCK_TITLE_MAX} caractères.`,
      );
    }

    const locCount = new Map<string, number>();
    for (const b of blocks) {
      if (b.locationText) locCount.set(b.locationText, (locCount.get(b.locationText) ?? 0) + 1);
    }
    const locations = [...locCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
      .map(([l]) => l);

    return {
      ok: true,
      value: {
        blocks,
        locations,
        warnings: ctx.notes.list(),
        window,
        eventCount: events.length,
      },
    };
  } catch (e) {
    if (e instanceof BudgetError) {
      return { ok: false, error: "Les règles de récurrence de ce fichier sont trop longues." };
    }
    return { ok: false, error: "Ce fichier .ics est illisible (contenu inattendu)." };
  }
}

// ─── Lecture d'un événement ─────────────────────────────────────────────────────────────────

interface Ctx {
  appZone: string;
  window: { from: string; to: string };
  windowStart: Date;
  windowEnd: Date;
  budget: number;
  /** Travail réel restant (voir ICS_MAX_WORK). */
  work: number;
  /** Début des occurrences « bien avant la fenêtre » (heure flottante, 00:00). */
  farPastBefore: string;
  notes: Notes;
  includeTransparent: boolean;
}

/** Morceau d'occurrence dans une journée locale. */
interface Piece {
  day: string;
  startMinute: number;
  endMinute: number;
  title: string;
  titleTruncated: boolean;
  locationText: string;
}

class BudgetError extends Error {}

/** Remarques regroupées par type (« 3 événements d'une journée entière ignorés »). */
class Notes {
  private counts = new Map<string, number>();
  private order: string[] = [];
  /** Fuseaux (TZID) inconnus, lus comme America/Toronto. */
  readonly unknownZones = new Set<string>();
  count(kind: NoteKind) {
    if (!this.counts.has(kind)) this.order.push(kind);
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }
  add(text: string) {
    this.order.push(text);
  }
  list(): string[] {
    const out = this.order.map((k) => {
      const n = this.counts.get(k);
      return n === undefined ? k : NOTE_TEXT[k as NoteKind](n);
    });
    if (this.unknownZones.size > 0) {
      const names = [...this.unknownZones].map((z) => `« ${z.slice(0, 40)} »`).join(", ");
      out.push(`Fuseau horaire inconnu (${names}) : heures lues comme celles du Québec.`);
    }
    return out;
  }
}

type NoteKind =
  "allDay" | "cancelled" | "transparent" | "noEnd" | "tooLong" | "unsupportedRule" | "past";

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const NOTE_TEXT: Record<NoteKind, (n: number) => string> = {
  allDay: (n) =>
    `${n} ${plural(n, "événement", "événements")} d'une journée entière ${plural(n, "ignoré", "ignorés")} (congés, rappels…).`,
  cancelled: (n) => `${n} ${plural(n, "événement annulé ignoré", "événements annulés ignorés")}.`,
  transparent: (n) =>
    `${n} ${plural(n, "événement marqué", "événements marqués")} « disponible » ${plural(n, "ignoré", "ignorés")}.`,
  noEnd: (n) =>
    `${n} ${plural(n, "événement", "événements")} sans heure de fin ${plural(n, "ignoré", "ignorés")}.`,
  tooLong: (n) =>
    `${n} ${plural(n, "événement", "événements")} de plus de 7 jours ${plural(n, "ignoré", "ignorés")}.`,
  unsupportedRule: (n) =>
    `${n} ${plural(n, "événement", "événements")} avec une règle de répétition non prise en charge ${plural(n, "ignoré", "ignorés")} : ajoute-${plural(n, "le", "les")} à la main.`,
  past: () => "Les occurrences passées ou dans plus d'un an ne sont pas importées.",
};

function readEvent(
  ev: InstanceType<typeof ICAL.Component>,
  replaced: Set<number> | undefined,
  ctx: Ctx,
  out: Piece[],
): void {
  const status = textProp(ev, "status")?.toUpperCase();
  if (status === "CANCELLED") return ctx.notes.count("cancelled");
  const dtstartProp = ev.getFirstProperty("dtstart");
  const dtstart = dtstartProp?.getFirstValue();
  if (!dtstartProp || !(dtstart instanceof ICAL.Time)) return ctx.notes.count("noEnd");
  if (dtstart.isDate) return ctx.notes.count("allDay");
  if (!ctx.includeTransparent && textProp(ev, "transp")?.toUpperCase() === "TRANSPARENT") {
    return ctx.notes.count("transparent");
  }

  const zone = resolveZone(paramOf(dtstartProp, "tzid"), dtstart, ctx.appZone, ctx.notes);
  const first = wallToInstant(dtstart, zone);

  // Durée : DTEND (même fuseau ou un autre) ou DURATION.
  let durationMs: number | null = null;
  const dtendProp = ev.getFirstProperty("dtend");
  const dtend = dtendProp?.getFirstValue();
  if (dtendProp && dtend instanceof ICAL.Time && !dtend.isDate) {
    const endZone = resolveZone(paramOf(dtendProp, "tzid"), dtend, zone, ctx.notes);
    durationMs = wallToInstant(dtend, endZone).getTime() - first.getTime();
  } else {
    const dur = ev.getFirstPropertyValue("duration");
    if (dur instanceof ICAL.Duration) durationMs = dur.toSeconds() * 1000;
  }
  if (durationMs === null || durationMs <= 0) return ctx.notes.count("noEnd");
  if (durationMs > MAX_EVENT_MINUTES * MS_PER_MINUTE) return ctx.notes.count("tooLong");

  const title = cleanTitle(textProp(ev, "summary") ?? "");
  const location = cleanLine(textProp(ev, "location") ?? "")
    .slice(0, ICS_LOCATION_MAX)
    .trim();

  // Occurrences (instants de début). Celles bien avant la fenêtre ne sont pas converties
  // (coûteux) : elles ne servent qu'à la remarque « occurrences passées » (voir plus bas).
  const starts = new Map<number, Date>();
  const farPast: FarPast = { skipped: [], certain: false };
  // Nombre d'occurrences qu'EXDATE et RECURRENCE-ID peuvent retirer (au plus une chacune).
  let exclusions = replaced?.size ?? 0;
  for (const prop of ev.getAllProperties("exdate")) exclusions += prop.getValues().length;
  const rrules = ev.getAllProperties("rrule");
  if (rrules.length === 0) {
    starts.set(first.getTime(), first);
  } else {
    for (const prop of rrules) {
      const recur = prop.getFirstValue();
      if (!(recur instanceof ICAL.Recur) || !isSupportedRule(recur)) {
        return ctx.notes.count("unsupportedRule");
      }
      if (!expandRule(recur, dtstart, zone, ctx, starts, farPast, exclusions)) {
        return ctx.notes.count("unsupportedRule");
      }
    }
  }
  for (const prop of ev.getAllProperties("rdate")) {
    const z = resolveZone(paramOf(prop, "tzid"), null, zone, ctx.notes);
    for (const v of prop.getValues() as unknown[]) {
      if (--ctx.work < 0) throw new BudgetError();
      if (v instanceof ICAL.Time && !v.isDate) {
        if (!isUtc(v) && wallDay(v) < ctx.farPastBefore) {
          farPast.skipped.push({ t: v, zone: z });
          continue;
        }
        const at = wallToInstant(v, z);
        starts.set(at.getTime(), at);
      }
    }
  }

  // Exclusions : EXDATE (date-heure ou jour entier) et occurrences remplacées.
  const exInstants = new Set<number>(replaced ?? []);
  const exDays = new Set<string>();
  for (const prop of ev.getAllProperties("exdate")) {
    const z = resolveZone(paramOf(prop, "tzid"), null, zone, ctx.notes);
    for (const v of prop.getValues() as unknown[]) {
      if (--ctx.work < 0) throw new BudgetError();
      if (!(v instanceof ICAL.Time)) continue;
      if (v.isDate) exDays.add(wallDay(v));
      else exInstants.add(wallToInstant(v, z).getTime());
    }
  }

  let outside = false;
  for (const start of starts.values()) {
    if (exInstants.has(start.getTime())) continue;
    if (exDays.size > 0 && exDays.has(formatInTimeZone(start, zone, "yyyy-MM-dd"))) continue;
    const end = new Date(start.getTime() + durationMs);
    const pieces = toPieces(start, end, ctx.appZone);
    for (const p of pieces) {
      if (p.day < ctx.window.from || p.day > ctx.window.to) {
        outside = true;
        continue;
      }
      out.push({ ...p, ...title, locationText: location });
    }
  }
  // Occurrences bien avant la fenêtre : toutes hors fenêtre. Comme avant, la remarque n'est
  // ajoutée que si au moins une n'est pas retirée par EXDATE ou RECURRENCE-ID.
  if (!outside && farPast.certain) outside = true;
  if (!outside) {
    for (const { t, zone: z } of farPast.skipped) {
      const start = wallToInstant(t, z);
      if (exInstants.has(start.getTime())) continue;
      if (exDays.size > 0 && exDays.has(formatInTimeZone(start, zone, "yyyy-MM-dd"))) continue;
      outside = true;
      break;
    }
  }
  if (outside) ctx.notes.count("past");
}

/** Règles prises en charge : DAILY/WEEKLY (BYDAY simple), MONTHLY/YEARLY sans BY-parts. */
function isSupportedRule(recur: InstanceType<typeof ICAL.Recur>): boolean {
  const parts = Object.entries(recur.parts ?? {}).filter(
    ([, v]) => v != null && (!Array.isArray(v) || v.length > 0),
  );
  const interval = recur.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return false;
  switch (recur.freq) {
    case "DAILY":
    case "WEEKLY":
      return parts.every(
        ([k, v]) =>
          k === "BYDAY" &&
          Array.isArray(v) &&
          v.every((d) => typeof d === "string" && /^(MO|TU|WE|TH|FR|SA|SU)$/.test(d)),
      );
    case "MONTHLY":
    case "YEARLY":
      return parts.length === 0;
    default:
      return false;
  }
}

/**
 * Déplie une RRULE en heure murale du fuseau `zone` (ical.js en heure « flottante »), puis
 * convertit chaque occurrence en instant. UNTIL en UTC est d'abord ramené en heure murale.
 * Renvoie faux si la règle est trop longue (événement ignoré).
 */
function expandRule(
  recur: InstanceType<typeof ICAL.Recur>,
  dtstart: InstanceType<typeof ICAL.Time>,
  zone: string,
  ctx: Ctx,
  out: Map<number, Date>,
  farPast: FarPast,
  exclusions: number,
): boolean {
  const rule = recur.clone();
  if (rule.until) {
    const u = rule.until;
    if (u.isDate) {
      // UNTIL=jour : le dernier jour est inclus en entier.
      rule.until = floating(u.year, u.month, u.day, 23, 59, 59);
    } else if (isUtc(u)) {
      const wall = formatInTimeZone(utcInstant(u), zone, "yyyy-M-d-H-m-s").split("-").map(Number);
      rule.until = floating(wall[0], wall[1], wall[2], wall[3], wall[4], wall[5]);
    } else {
      rule.until = floating(u.year, u.month, u.day, u.hour, u.minute, u.second);
    }
  }
  const start = floating(
    dtstart.year,
    dtstart.month,
    dtstart.day,
    dtstart.hour,
    dtstart.minute,
    dtstart.second,
  );
  let it = rule.iterator(start);
  const stopAfter = ctx.windowEnd.getTime() + 2 * MINUTES_PER_DAY * MS_PER_MINUTE;
  const jump = jumpPlan(rule, start);
  let jumped = false;
  for (let i = 0; ; i++) {
    if (i >= MAX_ITERATIONS_PER_EVENT) return false;
    if (--ctx.budget < 0) throw new BudgetError();
    if (--ctx.work < 0) throw new BudgetError();
    const next = it.next();
    if (!next) return true;
    if (wallDay(next) < ctx.farPastBefore) {
      // Bien avant la fenêtre : pas de conversion (l'occurrence est forcément hors fenêtre).
      farPast.skipped.push({ t: next.clone(), zone });
      if (!jumped && jump && wallDay(next) >= jump.phaseFrom) {
        // Saut de `j` périodes entières, toutes bien avant la fenêtre (et avant UNTIL) :
        // mêmes occurrences que l'itération une par une, sans les calculer. Les compteurs
        // (par événement et pour le fichier) avancent exactement comme avant.
        jumped = true;
        const limit =
          rule.until && wallDay(rule.until) < ctx.farPastBefore
            ? wallDay(rule.until)
            : ctx.farPastBefore;
        const j = Math.floor(daysBetween(wallDay(next), limit) / jump.periodDays) - 1;
        const occurrences = j * jump.perPeriod;
        if (j >= 1 && occurrences > exclusions) {
          const virtual = occurrences - 1; // l'occurrence courante est déjà comptée
          const allowed = Math.max(0, MAX_ITERATIONS_PER_EVENT - (i + 1));
          const steps = Math.min(virtual, allowed);
          if (steps > ctx.budget) throw new BudgetError();
          ctx.budget -= steps;
          i += steps;
          if (steps < virtual) return false;
          farPast.certain = true;
          const restart = next.clone();
          restart.adjust(j * jump.periodDays, 0, 0, 0);
          it = rule.iterator(restart);
        }
      }
      continue;
    }
    const at = wallToInstant(next, zone);
    if (at.getTime() > stopAfter) return true;
    out.set(at.getTime(), at);
  }
}

/** Occurrences bien avant la fenêtre, gardées sans conversion (remarque « passées »). */
interface FarPast {
  skipped: { t: InstanceType<typeof ICAL.Time>; zone: string }[];
  /** Vrai si un saut a passé plus d'occurrences que EXDATE ne peut en retirer. */
  certain: boolean;
}

/**
 * Règles qu'on peut sauter d'un coup, parce qu'elles se répètent à l'identique à partir d'une
 * occurrence de phase : DAILY ou WEEKLY sans BYDAY (une occurrence par période, dès DTSTART),
 * WEEKLY;INTERVAL=1 avec BYDAY (|BYDAY| occurrences par semaine, dès la 2e semaine). Pas de
 * COUNT (il compte depuis DTSTART). Les autres règles sont itérées une par une.
 */
function jumpPlan(
  rule: InstanceType<typeof ICAL.Recur>,
  start: InstanceType<typeof ICAL.Time>,
): { periodDays: number; perPeriod: number; phaseFrom: string } | null {
  if (rule.count) return null;
  const interval = rule.interval ?? 1;
  const byday = (rule.parts?.BYDAY as string[] | undefined) ?? [];
  const startDay = wallDay(start);
  if (byday.length === 0) {
    if (rule.freq === "DAILY") return { periodDays: interval, perPeriod: 1, phaseFrom: startDay };
    if (rule.freq === "WEEKLY") {
      return { periodDays: 7 * interval, perPeriod: 1, phaseFrom: startDay };
    }
    return null;
  }
  if (rule.freq === "WEEKLY" && interval === 1) {
    return { periodDays: 7, perPeriod: new Set(byday).size, phaseFrom: shiftDay(startDay, 7) };
  }
  return null;
}

/**
 * Découpe une occurrence en morceaux d'une journée locale (un bloc ne traverse pas minuit).
 * Fin à minuit pile : 24:00 le jour même.
 */
function toPieces(
  start: Date,
  end: Date,
  appZone: string,
): { day: string; startMinute: number; endMinute: number }[] {
  const [sDay, sMin] = localParts(start, appZone);
  const [eDay, eMin] = localParts(end, appZone);
  const pieces: { day: string; startMinute: number; endMinute: number }[] = [];
  for (let day = sDay, from = sMin; day <= eDay; day = shiftDay(day, 1), from = 0) {
    const to = day === eDay ? eMin : MINUTES_PER_DAY;
    if (to > from) pieces.push({ day, startMinute: from, endMinute: to });
  }
  return pieces;
}

function localParts(at: Date, zone: string): [string, number] {
  const [day, h, m] = formatInTimeZone(at, zone, "yyyy-MM-dd|H|m").split("|");
  return [day, Number(h) * 60 + Number(m)];
}

// ─── Regroupement en blocs hebdomadaires ───────────────────────────────────────────────────

function groupPieces(pieces: Piece[]): ImportedBlock[] {
  const groups = new Map<string, { sample: Piece; days: Set<string> }>();
  for (const p of pieces) {
    const k = [p.title, p.locationText, p.startMinute, p.endMinute, weekdayOf(p.day)].join(
      "\u0000",
    );
    const g = groups.get(k) ?? { sample: p, days: new Set<string>() };
    g.days.add(p.day);
    groups.set(k, g);
  }

  const blocks: ImportedBlock[] = [];
  for (const { sample, days } of groups.values()) {
    const sorted = [...days].sort();
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const weekly = run.length > 1;
      const from = run[0];
      const until = run[run.length - 1];
      blocks.push({
        key: [
          weekly ? "w" : "o",
          from,
          sample.startMinute,
          sample.endMinute,
          sample.title,
          sample.locationText,
        ].join("|"),
        title: sample.title,
        titleTruncated: sample.titleTruncated,
        locationText: sample.locationText,
        startMinute: sample.startMinute,
        endMinute: sample.endMinute,
        weekday: weekly ? weekdayOf(from) : null,
        validFrom: from,
        validUntil: until,
        occurrences: run.length,
      });
      run = [];
    };
    for (const day of sorted) {
      const prev = run[run.length - 1];
      // Semaine suivante, sans dépasser la période maximale d'un bloc (moins de 366 jours).
      if (prev && (daysBetween(prev, day) !== 7 || daysBetween(run[0], day) >= 365)) flush();
      run.push(day);
    }
    flush();
  }

  return blocks.sort(
    (a, b) =>
      Number(a.weekday == null) - Number(b.weekday == null) ||
      (a.weekday ?? 0) - (b.weekday ?? 0) ||
      a.validFrom.localeCompare(b.validFrom) ||
      a.startMinute - b.startMinute ||
      a.title.localeCompare(b.title, "fr"),
  );
}

// ─── Outils ─────────────────────────────────────────────────────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function cleanLine(raw: string): string {
  return cleanText(raw.replace(CONTROL_CHARS, " "));
}

/** Titre nettoyé ; plus de 100 caractères : raccourci avec « … ». */
function cleanTitle(raw: string): { title: string; titleTruncated: boolean } {
  const t = cleanLine(raw) || "Sans titre";
  if (t.length <= BLOCK_TITLE_MAX) return { title: t, titleTruncated: false };
  return { title: `${t.slice(0, BLOCK_TITLE_MAX - 1).trimEnd()}…`, titleTruncated: true };
}

function textProp(ev: InstanceType<typeof ICAL.Component>, name: string): string | null {
  const v = ev.getFirstPropertyValue(name);
  return typeof v === "string" ? v : null;
}

function paramOf(prop: InstanceType<typeof ICAL.Property>, name: string): string | null {
  const v = prop.getParameter(name);
  if (typeof v === "string") return v;
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

function isUtc(t: InstanceType<typeof ICAL.Time>): boolean {
  return t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === "UTC";
}

function utcInstant(t: InstanceType<typeof ICAL.Time>): Date {
  return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
}

function floating(y: number, mo: number, d: number, h: number, mi: number, s: number) {
  return new ICAL.Time(
    {
      year: y,
      month: mo,
      day: d,
      hour: h,
      minute: mi,
      second: s,
      isDate: false,
    },
    ICAL.Timezone.localTimezone,
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function wallDay(t: InstanceType<typeof ICAL.Time>): string {
  return `${String(t.year).padStart(4, "0")}-${pad(t.month)}-${pad(t.day)}`;
}

/** Heure murale (dans `zone`, ou UTC si la valeur finit par « Z ») → instant. */
function wallToInstant(t: InstanceType<typeof ICAL.Time>, zone: string): Date {
  if (isUtc(t)) return utcInstant(t);
  return zonedTime(wallDay(t), `${pad(t.hour)}:${pad(t.minute)}`, zone);
}

/** Noms Windows (Outlook) les plus courants → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/Toronto",
  "eastern daylight time": "America/Toronto",
  "us eastern standard time": "America/Toronto",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Edmonton",
  "pacific standard time": "America/Vancouver",
  "atlantic standard time": "America/Halifax",
  "newfoundland standard time": "America/St_Johns",
  utc: "UTC",
  "gmt standard time": "Europe/London",
  "romance standard time": "Europe/Paris",
  "w. europe standard time": "Europe/Berlin",
};

function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fuseau d'une valeur : « Z » → UTC ; TZID connu (IANA, préfixe Mozilla
 * « /mozilla.org/…/America/Toronto », nom Windows) ; sinon (heure flottante ou TZID inconnu)
 * `fallback`.
 */
function resolveZone(
  tzid: string | null,
  value: InstanceType<typeof ICAL.Time> | null,
  fallback: string,
  notes: Notes,
): string {
  if (value && isUtc(value)) return "UTC";
  if (!tzid) return fallback;
  const raw = tzid.trim().replace(/^"|"$/g, "");
  const candidates = [raw, raw.replace(/^.*?([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/, "$1")];
  for (const c of candidates) if (c && c.includes("/") && isIanaZone(c)) return c;
  const win = WINDOWS_ZONES[raw.toLowerCase()];
  if (win) return win;
  if (/^(utc|gmt|etc\/utc|z)$/i.test(raw)) return "UTC";
  notes.unknownZones.add(raw);
  return fallback;
}
