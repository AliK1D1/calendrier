/**
 * Segment 12 : fichier .ics d'un plan (« Ajouter à mon agenda »). Fonction pure.
 * Instants en UTC (suffixe Z) : aucun fuseau à décrire, chaque agenda affiche l'heure locale.
 */

/** Échappement d'un texte iCalendar (RFC 5545, 3.3.11). */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
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
}

/** Contenu du fichier .ics d'un plan. `now` : horodatage DTSTAMP. */
export function buildPlanIcs(plan: IcsPlan, now: Date, url?: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Temps libre commun//Plans//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:plan-${plan.id}@temps-libre-commun`,
    `DTSTAMP:${icsInstant(now.toISOString())}`,
    `DTSTART:${icsInstant(plan.startsAt)}`,
    `DTEND:${icsInstant(plan.endsAt)}`,
    `SUMMARY:${escapeIcsText(plan.title)}`,
    `LOCATION:${escapeIcsText(plan.where)}`,
    `DESCRIPTION:${escapeIcsText(`Plan du groupe « ${plan.groupName} »${url ? ` : ${url}` : ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
