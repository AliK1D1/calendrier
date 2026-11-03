/**
 * Segment 12 : validation d'une proposition de moment (fonctions pures, sans BD ni React).
 * La BD (`propose_meetup`) refait les mêmes vérifications : la clé « anon » est publique.
 */
import { formatInTimeZone } from "date-fns-tz";

import { validateUuid } from "@/lib/groups/validation";
import { cleanText, type Result } from "@/lib/places/validation";
import { addMinutesTo, TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import { formatClock, parseClock, shiftDay } from "@/lib/scheduling/weeklyBlocks";

export const PLAN_TITLE_MAX = 80;
export const PLAN_LOCATION_MAX = 100;
export const PLAN_MIN_MINUTES = 15;
export const PLAN_MAX_MINUTES = 12 * 60;
/** Durées proposées dans le formulaire (minutes). */
export const PLAN_DURATIONS = [30, 45, 60, 90, 120, 180, 240, 360, 480, 720] as const;
export const PLAN_DEFAULT_TITLE = "On se voit";
/** Titre affiché pour un plan sans titre (créé avant la migration 0009). */
export const PLAN_FALLBACK_TITLE = "Plan de groupe";

const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ce que le formulaire envoie. `inviteeIds` nul = tout le groupe. */
export interface ProposeFormInput {
  groupId: string;
  title: string;
  /** `yyyy-MM-dd`, heure locale America/Toronto. */
  date: string;
  /** `HH:mm`. */
  start: string;
  durationMinutes: number;
  placeId: string | null;
  location: string;
  inviteeIds: string[] | null;
}

/** Proposition validée, prête pour `propose_meetup`. */
export interface ProposeInput {
  groupId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  placeId: string | null;
  location: string;
  inviteeIds: string[] | null;
}

function text(raw: unknown, max: number, label: string, required: boolean): Result<string> {
  if (raw === undefined || raw === null) raw = "";
  if (typeof raw !== "string") return { ok: false, error: `${label} invalide.` };
  if (CONTROL_CHARS.test(raw))
    return { ok: false, error: `${label} contient des caractères invalides.` };
  const value = cleanText(raw);
  if (required && value.length === 0)
    return { ok: false, error: `${label} ne peut pas être vide.` };
  if (value.length > max) {
    return { ok: false, error: `${label} est trop long (${max} caractères au maximum).` };
  }
  return { ok: true, value };
}

/**
 * Valide le formulaire « Proposer un moment ». `now` : pour refuser un moment passé.
 * Un plan finit le même jour (au plus tard à minuit) : un bloc d'horaire ne traverse pas minuit.
 */
export function validatePropose(raw: unknown, now: Date): Result<ProposeInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Proposition invalide." };
  const r = raw as Record<string, unknown>;

  const gid = validateUuid(r.groupId);
  if (!gid.ok) return gid;
  const title = text(r.title, PLAN_TITLE_MAX, "Le titre", true);
  if (!title.ok) return title;
  const location = text(r.location, PLAN_LOCATION_MAX, "Le lieu", false);
  if (!location.ok) return location;

  let placeId: string | null = null;
  if (r.placeId !== null && r.placeId !== undefined && r.placeId !== "") {
    const pid = validateUuid(r.placeId, "Lieu introuvable.");
    if (!pid.ok) return pid;
    placeId = pid.value;
  }

  let inviteeIds: string[] | null = null;
  if (r.inviteeIds !== null && r.inviteeIds !== undefined) {
    if (!Array.isArray(r.inviteeIds) || r.inviteeIds.length > 100) {
      return { ok: false, error: "Liste de personnes invalide." };
    }
    const ids = new Set<string>();
    for (const id of r.inviteeIds) {
      const v = validateUuid(id, "Membre introuvable.");
      if (!v.ok) return v;
      ids.add(v.value);
    }
    if (ids.size === 0) return { ok: false, error: "Choisis au moins une personne à inviter." };
    inviteeIds = [...ids];
  }

  if (typeof r.date !== "string" || !DAY_RE.test(r.date)) {
    return { ok: false, error: "Choisis un jour." };
  }
  const startMin = typeof r.start === "string" ? parseClock(r.start) : null;
  if (startMin === null || startMin >= 24 * 60)
    return { ok: false, error: "Heure de début invalide." };
  const duration = Number(r.durationMinutes);
  if (!Number.isInteger(duration) || duration < PLAN_MIN_MINUTES || duration > PLAN_MAX_MINUTES) {
    return { ok: false, error: "Un plan dure de 15 minutes à 12 heures." };
  }

  let start: Date;
  try {
    start = zonedTime(r.date, formatClock(startMin));
  } catch {
    return { ok: false, error: "Jour invalide." };
  }
  const end = addMinutesTo(start, duration);
  if (start.getTime() <= now.getTime()) {
    return { ok: false, error: "Ce moment est déjà commencé ou passé." };
  }
  if (start.getTime() > now.getTime() + 365 * 24 * 3600 * 1000) {
    return { ok: false, error: "Propose un moment dans la prochaine année." };
  }
  const startDay = formatInTimeZone(start, TIME_ZONE, "yyyy-MM-dd");
  const endDay = formatInTimeZone(end, TIME_ZONE, "yyyy-MM-dd");
  const endClock = formatInTimeZone(end, TIME_ZONE, "HH:mm");
  // Au plus 12 h : la fin est le même jour ou le lendemain ; le lendemain, seulement à minuit.
  if (endDay !== startDay && endClock !== "00:00") {
    return { ok: false, error: "Un plan finit le même jour (au plus tard à minuit)." };
  }

  return {
    ok: true,
    value: {
      groupId: gid.value,
      title: title.value,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      placeId,
      location: location.value,
      inviteeIds,
    },
  };
}

/** Valeurs de départ du formulaire à partir d'un créneau (carte « Quand on peut se voir »). */
export function draftFromSlot(
  startIso: string,
  durationMinutes: number,
): { date: string; start: string; durationMinutes: number } {
  const start = new Date(startIso);
  return {
    date: formatInTimeZone(start, TIME_ZONE, "yyyy-MM-dd"),
    start: formatInTimeZone(start, TIME_ZONE, "HH:mm"),
    durationMinutes: Math.max(PLAN_MIN_MINUTES, Math.min(PLAN_MAX_MINUTES, durationMinutes)),
  };
}

/**
 * Jour et heure proposés par défaut pour un moment libre : la prochaine heure pleine (au moins
 * 30 min d'avance), ou demain 18 h s'il est trop tard ce soir (après 21 h).
 */
export function defaultFreeSlot(now: Date): { date: string; start: string } {
  const soon = addMinutesTo(now, 90);
  const day = formatInTimeZone(soon, TIME_ZONE, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(soon, TIME_ZONE, "H"));
  const today = formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
  if (day !== today || hour > 21) {
    return { date: shiftDay(today, 1), start: "18:00" };
  }
  return { date: today, start: `${String(Math.max(hour, 8)).padStart(2, "0")}:00` };
}
