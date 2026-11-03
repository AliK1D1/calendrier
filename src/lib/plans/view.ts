/**
 * Segment 12 : mise en forme des plans pour l'interface (fonctions pures, sans BD ni React).
 */
import { formatInTimeZone } from "date-fns-tz";
import { frCA } from "date-fns/locale";

import { parseClock, formatClockFr } from "@/lib/scheduling/weeklyBlocks";
import { TIME_ZONE } from "@/lib/scheduling/time";

import { PLAN_FALLBACK_TITLE } from "./validation";

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
  /** « mardi 16 mars » */
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
}

export interface PlanContext {
  myId: string;
  now: Date;
  names: ReadonlyMap<string, string>;
  groupNames: ReadonlyMap<string, string>;
  placeNames: ReadonlyMap<string, string>;
  /** Membres actuels de chaque groupe (pour savoir si « tout le groupe » est invité). */
  groupMembers: ReadonlyMap<string, readonly string[]>;
}

function clock(instant: Date): string {
  const m = parseClock(formatInTimeZone(instant, TIME_ZONE, "HH:mm"));
  return m === null ? "" : formatClockFr(m);
}

/** Construit les vues des plans (triés par début). */
export function buildPlanViews(
  plans: readonly PlanRow[],
  invitees: readonly PlanInviteeInput[],
  votes: readonly PlanVoteInput[],
  ctx: PlanContext,
): PlanView[] {
  const name = (id: string) => ctx.names.get(id) || "Sans nom";
  const invitedBy = new Map<string, string[]>();
  for (const i of invitees)
    invitedBy.set(i.plan_id, [...(invitedBy.get(i.plan_id) ?? []), i.user_id]);
  const voteOf = new Map<string, "yes" | "no" | "maybe">();
  for (const v of votes) voteOf.set(`${v.plan_id}:${v.user_id}`, v.vote);

  return [...plans]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((p) => {
      const start = new Date(p.starts_at);
      const end = new Date(p.ends_at);
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
        p.status === "cancelled" ? "cancelled" : end <= ctx.now ? "past" : "upcoming";
      const placeName = p.place_id ? ctx.placeNames.get(p.place_id) : undefined;
      const endLabel =
        formatInTimeZone(end, TIME_ZONE, "HH:mm") === "00:00" ? "minuit" : clock(end);
      return {
        id: p.id,
        groupId: p.group_id,
        groupName: ctx.groupNames.get(p.group_id) ?? "Groupe",
        title: p.title.trim() || PLAN_FALLBACK_TITLE,
        dayLabel: formatInTimeZone(start, TIME_ZONE, "EEEE d MMMM", { locale: frCA }),
        timeLabel: `${clock(start)} – ${endLabel}`,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        where: placeName || p.location.trim() || (p.place_id ? "Lieu" : "Lieu à préciser"),
        creatorName: name(p.created_by),
        isMine: p.created_by === ctx.myId,
        invited: people.includes(ctx.myId),
        myResponse: mine === "yes" ? "yes" : mine === "no" ? "no" : null,
        state,
        accepted,
        declined,
        waiting,
        wholeGroup: members.length > 0 && members.every((m) => people.includes(m)),
      };
    });
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
 * et pas fini, sans être le créateur) et de mes réponses.
 */
export function countAwaiting(
  myInvitations: readonly {
    plan_id: string;
    created_by: string;
    status: string;
    ends_at: string;
  }[],
  myVotes: readonly { plan_id: string }[],
  myId: string,
  now: Date,
): number {
  const answered = new Set(myVotes.map((v) => v.plan_id));
  return myInvitations.filter(
    (i) =>
      i.status === "proposed" &&
      new Date(i.ends_at) > now &&
      i.created_by !== myId &&
      !answered.has(i.plan_id),
  ).length;
}
