/**
 * Lecture du calendrier par Microsoft Graph (lecture seule). Le `fetch` est injecté.
 *
 * On ne demande à Graph que ce qui sert à savoir quand la personne est occupée : début, fin,
 * « toute la journée », disponibilité affichée (`showAs`) et annulation. Jamais le titre, le
 * lieu, la description ni les participants.
 */
import { allDayRange, countsAsBusy, type ExternalBusyEvent } from "@/lib/scheduling/outlookBusy";

import { type FetchLike, MICROSOFT_TIMEOUT_MS, OutlookError } from "./oauth";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Au plus 10 pages de 200 événements par synchronisation. */
export const GRAPH_MAX_PAGES = 10;
const PAGE_SIZE = 200;

export interface OutlookCalendar {
  id: string;
  name: string;
  isDefault: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function graphGet(
  fetch: FetchLike,
  accessToken: string,
  url: string,
): Promise<Record<string, unknown>> {
  // Le jeton n'est envoyé qu'à Graph (protège contre un « nextLink » qui pointerait ailleurs).
  if (!url.startsWith(`${GRAPH_BASE}/`)) {
    throw new OutlookError("Réponse inattendue d'Outlook.", "invalid");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        Prefer: 'outlook.timezone="UTC"',
      },
      signal: AbortSignal.timeout(MICROSOFT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new OutlookError("Outlook ne répond pas. Réessaie dans quelques minutes.", "unavailable");
  }
  if (!res.ok) {
    console.error("Outlook : Graph a répondu", res.status);
    if (res.status === 401 || res.status === 403) {
      throw new OutlookError(
        "Outlook refuse l'accès à ce calendrier. Reconnecte Outlook.",
        "reauth",
      );
    }
    if (res.status === 404) {
      throw new OutlookError(
        "Ce calendrier Outlook n'existe plus. Choisis-en un autre.",
        "invalid",
      );
    }
    throw new OutlookError("Outlook ne répond pas. Réessaie dans quelques minutes.", "unavailable");
  }
  try {
    const json: unknown = await res.json();
    if (isRecord(json)) return json;
  } catch {
    // traité plus bas
  }
  throw new OutlookError("Réponse inattendue d'Outlook.", "invalid");
}

/** Adresse du compte connecté (pour l'afficher), ou « ». */
export async function getAccountEmail(fetch: FetchLike, accessToken: string): Promise<string> {
  const me = await graphGet(fetch, accessToken, `${GRAPH_BASE}/me?$select=mail,userPrincipalName`);
  const mail = typeof me.mail === "string" && me.mail ? me.mail : me.userPrincipalName;
  return typeof mail === "string" ? mail.slice(0, 320) : "";
}

/** Calendriers du compte (principal d'abord). */
export async function listCalendars(
  fetch: FetchLike,
  accessToken: string,
): Promise<OutlookCalendar[]> {
  const json = await graphGet(
    fetch,
    accessToken,
    `${GRAPH_BASE}/me/calendars?$select=id,name,isDefaultCalendar&$top=100`,
  );
  const value = Array.isArray(json.value) ? json.value : [];
  const calendars: OutlookCalendar[] = [];
  for (const c of value) {
    if (!isRecord(c) || typeof c.id !== "string" || c.id.length === 0 || c.id.length > 1024) {
      continue;
    }
    calendars.push({
      id: c.id,
      name: (typeof c.name === "string" && c.name.trim() ? c.name.trim() : "Calendrier").slice(
        0,
        255,
      ),
      isDefault: c.isDefaultCalendar === true,
    });
  }
  return calendars.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** « 2026-11-04T15:00:00.0000000 » (UTC, sans « Z ») → instant ; `null` si illisible. */
export function parseGraphUtc(dateTime: unknown): Date | null {
  if (typeof dateTime !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z?$/.exec(dateTime);
  if (!m) return null;
  const ms = m[2] ? m[2].slice(0, 4).padEnd(4, "0") : "";
  const d = new Date(`${m[1]}${ms}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Un élément de `calendarView` → événement occupé, ou `null` (libre, annulé, illisible). */
export function toBusyEvent(raw: unknown): ExternalBusyEvent | null {
  if (!isRecord(raw)) return null;
  if (!countsAsBusy(typeof raw.showAs === "string" ? raw.showAs : null, raw.isCancelled === true)) {
    return null;
  }
  const start = isRecord(raw.start) ? raw.start : null;
  const end = isRecord(raw.end) ? raw.end : null;
  if (!start || !end) return null;
  if (raw.isAllDay === true) {
    if (typeof start.dateTime !== "string" || typeof end.dateTime !== "string") return null;
    const r = allDayRange(start.dateTime, end.dateTime);
    return r ? { kind: "allDay", firstDay: r.from, lastDay: r.to } : null;
  }
  // On demande l'UTC (en-tête Prefer) ; un autre fuseau serait mal lu : on l'ignore.
  if (start.timeZone !== "UTC" || end.timeZone !== "UTC") return null;
  const s = parseGraphUtc(start.dateTime);
  const e = parseGraphUtc(end.dateTime);
  if (!s || !e || e <= s) return null;
  return { kind: "timed", start: s, end: e };
}

/**
 * Événements occupés du calendrier (`calendarId` nul : le principal) entre deux instants,
 * récurrences déjà dépliées par Graph (`calendarView`). `truncated` : plus de 10 pages.
 */
export async function getBusyEvents(
  fetch: FetchLike,
  accessToken: string,
  calendarId: string | null,
  range: { start: Date; end: Date },
): Promise<{ events: ExternalBusyEvent[]; truncated: boolean }> {
  const base = calendarId
    ? `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
    : `${GRAPH_BASE}/me/calendar/calendarView`;
  const params = new URLSearchParams({
    startDateTime: range.start.toISOString(),
    endDateTime: range.end.toISOString(),
    $select: "start,end,isAllDay,showAs,isCancelled",
    $top: String(PAGE_SIZE),
  });
  let url: string | null = `${base}?${params.toString()}`;
  const events: ExternalBusyEvent[] = [];
  for (let page = 0; url && page < GRAPH_MAX_PAGES; page++) {
    const json = await graphGet(fetch, accessToken, url);
    for (const item of Array.isArray(json.value) ? json.value : []) {
      const ev = toBusyEvent(item);
      if (ev) events.push(ev);
    }
    const next = json["@odata.nextLink"];
    url = typeof next === "string" && next ? next : null;
  }
  return { events, truncated: url !== null };
}
