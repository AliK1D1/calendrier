/**
 * Segment 12 : mise en forme des plans pour l'interface (fonctions pures, sans BD ni React).
 */
import { formatInTimeZone } from "date-fns-tz";

import type { Locale } from "@/lib/i18n/config";
import { formatInstantClock, formatInstantDay, weekdayLong } from "@/lib/i18n/format";
import { getMessages } from "@/lib/i18n/messages";

import {
  describeEvery,
  describeRepeat,
  nextOccurrence,
  type RepeatUnit,
} from "@/lib/scheduling/recurrence";
import { shiftDay, type Weekday } from "@/lib/scheduling/weeklyBlocks";
import { addMinutesTo, TIME_ZONE, zonedTime } from "@/lib/scheduling/time";

import type { LeaveByView } from "./leaveBy";

/** Ligne de `meetup_plans` lue par l'app. */
export interface PlanRow {
  id: string;
  group_id: string;
  title: string;
  location: string;
  place_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "proposed" | "confirmed" | "cancelled";
  created_by: string;
  created_at: string;
  /** Story 5 (migration 0018) : répétition ; nulle ou absente = une seule fois. */
  repeat_unit?: RepeatUnit | null;
  repeat_every?: number | null;
  repeat_until?: string | null;
}

export interface PlanVoteInput {
  plan_id: string;
  user_id: string;
  vote: "yes" | "no" | "maybe";
}

export interface PlanInviteeInput {
  plan_id: string;
  user_id: string;
}

export type PlanState = "upcoming" | "past" | "cancelled";
export type MyResponse = "yes" | "no" | null;

/** Plan tel qu'affiché. */
export interface PlanView {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  /** « mardi 16 mars » (plan récurrent : la prochaine fois). */
  dayLabel: string;
  /** « 18 h – 20 h » */
  timeLabel: string;
  startsAt: string;
  endsAt: string;
  /** Lieu enregistré (nom lisible), lieu écrit à la main, ou « Lieu à préciser ». */
  where: string;
  creatorName: string;
  isMine: boolean;
  /** Je suis invité·e (je peux répondre). */
  invited: boolean;
  myResponse: MyResponse;
  state: PlanState;
  accepted: string[];
  declined: string[];
  waiting: string[];
  /** Tout le groupe était invité. */
  wholeGroup: boolean;
  /**
   * Story 5 : répétition en mots (« Tous les 2 jours », « Chaque semaine, le mardi, jusqu'au
   * 30 juin 2027 »), `null` pour un plan d'une seule fois.
   */
  repeatLabel: string | null;
  /** Story 5 : la série (première fois et répétition), pour le fichier .ics ; sinon `null`. */
  series: PlanSeries | null;
  /** Lieu enregistré du plan (`null` : appel, ou lieu écrit à la main). */
  placeId: string | null;
  /** Story 6 : quand partir pour y être (seulement mes prochains plans en personne). */
  leaveBy?: LeaveByView;
}

export interface PlanSeries {
  unit: RepeatUnit;
  every: number;
  until: string | null;
  firstStartsAt: string;
  firstEndsAt: string;
}

export interface PlanContext {
  myId: string;
  now: Date;
  names: ReadonlyMap<string, string>;
  groupNames: ReadonlyMap<string, string>;
  placeNames: ReadonlyMap<string, string>;
  /** Membres actuels de chaque groupe (pour savoir si « tout le groupe » est invité). */
  groupMembers: ReadonlyMap<string, readonly string[]>;
  /** Langue des libellés (français par défaut). */
  locale?: Locale;
}

/** Fait commencer une phrase par une majuscule. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Répétition d'un plan en mots, ou `null` (une seule fois). */
export function planRepeatLabel(
  p: Pick<PlanRow, "starts_at" | "repeat_unit" | "repeat_every" | "repeat_until">,
  locale: Locale = "fr",
): string | null {
  if (!p.repeat_unit) return null;
  const t = getMessages(locale).plans;
  const every = p.repeat_every ?? 1;
  const anchor = formatInTimeZone(new Date(p.starts_at), TIME_ZONE, "yyyy-MM-dd");
  let label: string;
  if (p.repeat_unit === "week") {
    const weekday = Number(formatInTimeZone(new Date(p.starts_at), TIME_ZONE, "i"));
    label = t.weeklyOn(
      describeEvery(every, "week", locale),
      weekdayLong(weekday as Weekday, locale),
    );
  } else {
    label = describeRepeat({ unit: p.repeat_unit, every, anchor }, locale);
  }
  if (p.repeat_until) {
    const until = formatInstantDay(zonedTime(p.repeat_until, "12:00"), "dayMonthYear", locale);
    label = t.until(label, until);
  }
  return capitalize(label);
}

/**
 * Prochaine fois d'un plan (story 5) à l'instant `now` : la première occurrence qui n'est pas
 * finie, aux mêmes heures locales que la première fois. Plan d'une seule fois : lui-même, ou
 * `null` s'il est fini. Plan récurrent : `null` si la série est finie (après `repeat_until`).
 */
export function nextPlanOccurrence(
  p: Pick<PlanRow, "starts_at" | "ends_at" | "repeat_unit" | "repeat_every" | "repeat_until">,
  now: Date,
): { start: Date; end: Date } | null {
  const first = { start: new Date(p.starts_at), end: new Date(p.ends_at) };
  if (!p.repeat_unit) return first.end > now ? first : null;
  const minutes = Math.round((first.end.getTime() - first.start.getTime()) / 60_000);
  const rule = {
    unit: p.repeat_unit,
    every: p.repeat_every ?? 1,
    anchor: formatInTimeZone(first.start, TIME_ZONE, "yyyy-MM-dd"),
  };
  const startClock = formatInTimeZone(first.start, TIME_ZONE, "HH:mm");
  const until = p.repeat_until ?? null;
  // Un plan finit au plus tard à minuit : celle d'hier est finie. On part donc d'aujourd'hui,
  // puis du lendemain si celle d'aujourd'hui est finie.
  let from = formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
  for (let tries = 0; tries < 2; tries += 1) {
    const day = nextOccurrence(rule, from, until);
    if (day === null) return null;
    const start = zonedTime(day, startClock);
    const end = addMinutesTo(start, minutes);
    if (end > now) return { start, end };
    from = shiftDay(day, 1);
  }
  return null;
}

/** Construit les vues des plans (triés par début ; plan récurrent : par sa prochaine fois). */
export function buildPlanViews(
  plans: readonly PlanRow[],
  invitees: readonly PlanInviteeInput[],
  votes: readonly PlanVoteInput[],
  ctx: PlanContext,
): PlanView[] {
  const locale = ctx.locale ?? "fr";
  const t = getMessages(locale).plans;
  const clock = (instant: Date) => formatInstantClock(instant, locale);
  const name = (id: string) => ctx.names.get(id) || t.noName;
  const invitedBy = new Map<string, string[]>();
  for (const i of invitees)
    invitedBy.set(i.plan_id, [...(invitedBy.get(i.plan_id) ?? []), i.user_id]);
  const voteOf = new Map<string, "yes" | "no" | "maybe">();
  for (const v of votes) voteOf.set(`${v.plan_id}:${v.user_id}`, v.vote);

  return plans
    .map((p): PlanView => {
      const next = p.status === "cancelled" ? null : nextPlanOccurrence(p, ctx.now);
      // Plan fini ou annulé : on montre la première fois (série) ou le plan lui-même.
      const start = next?.start ?? new Date(p.starts_at);
      const end = next?.end ?? new Date(p.ends_at);
      const people = invitedBy.get(p.id) ?? [];
      const accepted: string[] = [];
      const declined: string[] = [];
      const waiting: string[] = [];
      for (const id of people) {
        const v = voteOf.get(`${p.id}:${id}`);
        if (v === "yes") accepted.push(name(id));
        else if (v === "no") declined.push(name(id));
        else waiting.push(name(id));
      }
      const mine = voteOf.get(`${p.id}:${ctx.myId}`);
      const members = ctx.groupMembers.get(p.group_id) ?? [];
      const state: PlanState =
        p.status === "cancelled" ? "cancelled" : next === null ? "past" : "upcoming";
      const placeName = p.place_id ? ctx.placeNames.get(p.place_id) : undefined;
      const endLabel = clock(end);
      return {
        id: p.id,
        groupId: p.group_id,
        groupName: ctx.groupNames.get(p.group_id) ?? t.group,
        title: p.title.trim() || t.fallbackTitle,
        dayLabel: formatInstantDay(start, "weekdayDayMonth", locale),
        timeLabel: `${clock(start)} – ${endLabel}`,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        where: placeName || p.location.trim() || (p.place_id ? t.place : t.placeTbd),
        creatorName: name(p.created_by),
        isMine: p.created_by === ctx.myId,
        invited: people.includes(ctx.myId),
        myResponse: mine === "yes" ? "yes" : mine === "no" ? "no" : null,
        state,
        accepted,
        declined,
        waiting,
        wholeGroup: members.length > 0 && members.every((m) => people.includes(m)),
        repeatLabel: planRepeatLabel(p, locale),
        series: p.repeat_unit
          ? {
              unit: p.repeat_unit,
              every: p.repeat_every ?? 1,
              until: p.repeat_until ?? null,
              firstStartsAt: p.starts_at,
              firstEndsAt: p.ends_at,
            }
          : null,
        placeId: p.place_id,
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Plans qui attendent ma réponse (badge de l'en-tête). */
export function isAwaitingMe(p: PlanView): boolean {
  return p.state === "upcoming" && p.invited && p.myResponse === null && !p.isMine;
}

/** Répartition de la page /plans. */
export function groupPlans(views: readonly PlanView[]): {
  awaiting: PlanView[];
  upcoming: PlanView[];
  others: PlanView[];
  past: PlanView[];
} {
  const awaiting: PlanView[] = [];
  const upcoming: PlanView[] = [];
  const others: PlanView[] = [];
  const past: PlanView[] = [];
  for (const p of views) {
    if (p.state !== "upcoming") past.push(p);
    else if (isAwaitingMe(p)) awaiting.push(p);
    else if (p.myResponse === "yes" || p.isMine) upcoming.push(p);
    else others.push(p);
  }
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { awaiting, upcoming, others, past };
}

/**
 * Nombre de plans qui attendent ma réponse, à partir de mes invitations (plan encore proposé
 * et pas fini, série récurrente pas finie, sans être le créateur) et de mes réponses.
 */
export function countAwaiting(
  myInvitations: readonly ({
    plan_id: string;
    created_by: string;
    status: string;
  } & Pick<PlanRow, "starts_at" | "ends_at" | "repeat_unit" | "repeat_every" | "repeat_until">)[],
  myVotes: readonly { plan_id: string }[],
  myId: string,
  now: Date,
): number {
  const answered = new Set(myVotes.map((v) => v.plan_id));
  return myInvitations.filter(
    (i) =>
      i.status === "proposed" &&
      nextPlanOccurrence(i, now) !== null &&
      i.created_by !== myId &&
      !answered.has(i.plan_id),
  ).length;
}
