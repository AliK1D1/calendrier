/**
 * Segment 12 : fichier .ics d'un plan (« Ajouter à mon agenda »). Fonction pure.
 * Plan d'une seule fois : instants en UTC (suffixe Z), chaque agenda affiche l'heure locale.
 * Story 5 : un plan récurrent est UNE série (RRULE) en heure locale America/Toronto (TZID) :
 * en UTC, « tous les jours à 18 h » passerait à 17 h ou 19 h au changement d'heure.
 * Chaque plan a un rappel 30 min avant (VALARM) : c'est la notification sur le téléphone.
 */
import { formatInTimeZone } from "date-fns-tz";

import type { PlanSeries } from "./view";
import { TIME_ZONE, zonedTime } from "@/lib/scheduling/time";

/** Rappel avant chaque fois (minutes). */
export const PLAN_REMINDER_MINUTES = 30;

/**
 * Échappement d'un texte iCalendar (RFC 5545, 3.3.11). Tout saut de ligne (y compris un « \r »
 * seul, que beaucoup d'agendas lisent comme une fin de ligne) devient « \n », et les autres
 * caractères de contrôle sont retirés : un titre ne peut pas ajouter de lignes au fichier.
 */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** « 2027-03-16T22:00:00.000Z » → « 20270316T220000Z ». */
function icsInstant(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Coupe les lignes à 75 octets (RFC 5545, 3.1), sans couper un caractère UTF-8. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export interface IcsPlan {
  id: string;
  title: string;
  where: string;
  groupName: string;
  startsAt: string;
  endsAt: string;
  /** Plan récurrent (story 5) : la série part de `series.firstStartsAt`. */
  series?: PlanSeries | null;
}

const FREQ = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" } as const;

/** « 2027-03-16T22:00:00Z » → « 20270316T180000 » (heure locale America/Toronto). */
function localStamp(iso: string): string {
  return formatInTimeZone(new Date(iso), TIME_ZONE, "yyyyMMdd'T'HHmmss");
}

/**
 * Règle RRULE d'une série. Mois et ans : un 29, 30 ou 31 prend le dernier jour des mois trop
 * courts (comme dans l'horaire) : BYMONTHDAY=28,29,30;BYSETPOS=-1 = « le 30, ou le dernier
 * jour s'il n'y a pas de 30 ». Fin : la fin du dernier jour, en UTC (RFC 5545, 3.3.10).
 */
export function seriesRrule(series: PlanSeries): string {
  const parts = [`FREQ=${FREQ[series.unit]}`, `INTERVAL=${series.every}`];
  const first = new Date(series.firstStartsAt);
  const day = Number(formatInTimeZone(first, TIME_ZONE, "d"));
  const month = Number(formatInTimeZone(first, TIME_ZONE, "M"));
  if (series.unit === "month" || series.unit === "year") {
    if (series.unit === "year") parts.push(`BYMONTH=${month}`);
    if (day > 28) {
      const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
      parts.push(`BYMONTHDAY=${days}`, "BYSETPOS=-1");
    } else {
      parts.push(`BYMONTHDAY=${day}`);
    }
  }
  if (series.until) {
    parts.push(`UNTIL=${icsInstant(zonedTime(series.until, "23:59").toISOString())}`);
  }
  return parts.join(";");
}

/** Contenu du fichier .ics d'un plan. `now` : horodatage DTSTAMP. */
export function buildPlanIcs(plan: IcsPlan, now: Date, url?: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Freecrew//Plans//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:plan-${plan.id}@temps-libre-commun`,
    `DTSTAMP:${icsInstant(now.toISOString())}`,
    ...(plan.series
      ? [
          `DTSTART;TZID=${TIME_ZONE}:${localStamp(plan.series.firstStartsAt)}`,
          `DTEND;TZID=${TIME_ZONE}:${localStamp(plan.series.firstEndsAt)}`,
          `RRULE:${seriesRrule(plan.series)}`,
        ]
      : [`DTSTART:${icsInstant(plan.startsAt)}`, `DTEND:${icsInstant(plan.endsAt)}`]),
    `SUMMARY:${escapeIcsText(plan.title)}`,
    `LOCATION:${escapeIcsText(plan.where)}`,
    `DESCRIPTION:${escapeIcsText(`Plan du groupe « ${plan.groupName} »${url ? ` : ${url}` : ""}`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(plan.title)}`,
    `TRIGGER:-PT${PLAN_REMINDER_MINUTES}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
