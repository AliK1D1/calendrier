import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildPlanViews,
  countAwaiting,
  type PlanInviteeInput,
  type PlanRow,
  type PlanView,
  type PlanVoteInput,
} from "./view";

/** Plans lus au plus : au-delà, les plus anciens ne s'affichent pas. */
const MAX_PLANS = 150;
/** Plans passés gardés dans « Mes plans ». */
const PAST_DAYS = 60;

export type PlansResult =
  { ok: true; views: PlanView[] } | { ok: false; error: string; outdated: boolean };

const PLAN_COLUMNS =
  "id, group_id, title, location, place_id, starts_at, ends_at, status, created_by, created_at, repeat_unit, repeat_every, repeat_until";

/**
 * Filtre PostgREST « pas encore fini à `since` » : plan qui finit après `since`, ou série
 * récurrente sans fin, ou dont le dernier jour n'est pas passé (story 5).
 */
function notOverFilter(since: Date): string {
  const day = since.toISOString().slice(0, 10);
  // Jour UTC un jour plus tôt : couvre le jour local America/Toronto (en retard sur UTC).
  const dayBefore = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `ends_at.gt.${since.toISOString()},and(repeat_unit.not.is.null,repeat_until.is.null),repeat_until.gte.${dayBefore}`;
}

function isOutdated(error: { code?: string }): boolean {
  // Colonne ou table absente : une migration (0009, 0018…) n'est pas appliquée.
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST200" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205"
  );
}

/**
 * Plans des groupes dont je suis membre (la RLS ne renvoie que ceux-là), mis en forme.
 * `groupId` : seulement ce groupe, et seulement les plans pas encore finis.
 * `planId` : ce plan seulement (passé ou non).
 */
export async function loadPlans(
  supabase: SupabaseClient,
  myId: string,
  now: Date,
  opts: { groupId?: string; planId?: string } = {},
): Promise<PlansResult> {
  let query = supabase.from("meetup_plans").select(PLAN_COLUMNS);
  if (opts.planId) {
    query = query.eq("id", opts.planId);
  } else if (opts.groupId) {
    query = query.eq("group_id", opts.groupId).or(notOverFilter(now));
  } else {
    query = query.or(notOverFilter(new Date(now.getTime() - PAST_DAYS * 86_400_000)));
  }
  const plans = await query
    .order("starts_at", { ascending: true })
    .limit(MAX_PLANS)
    .returns<PlanRow[]>();
  if (plans.error) {
    console.error("Plans :", plans.error.code, plans.error.message);
    const outdated = isOutdated(plans.error);
    return {
      ok: false,
      outdated,
      error: outdated
        ? "La base de données n'est pas à jour : applique supabase/migration-0018.sql (et les précédentes, voir README)."
        : "Impossible de lire les plans. Réessaie.",
    };
  }
  const rows = plans.data ?? [];
  const ids = rows.map((p) => p.id);
  const groupIds = [...new Set(rows.map((p) => p.group_id))];
  const placeIds = [...new Set(rows.map((p) => p.place_id).filter((x): x is string => !!x))];

  const empty = { data: [], error: null };
  const [invitees, votes, groups, members, places] = await Promise.all([
    ids.length
      ? supabase
          .from("plan_invitees")
          .select("plan_id, user_id")
          .in("plan_id", ids)
          .returns<PlanInviteeInput[]>()
      : empty,
    ids.length
      ? supabase
          .from("plan_votes")
          .select("plan_id, user_id, vote")
          .in("plan_id", ids)
          .returns<PlanVoteInput[]>()
      : empty,
    groupIds.length
      ? supabase
          .from("groups")
          .select("id, name")
          .in("id", groupIds)
          .returns<{ id: string; name: string }[]>()
      : empty,
    groupIds.length
      ? supabase
          .from("group_members")
          .select("group_id, user_id, profiles(display_name)")
          .in("group_id", groupIds)
          .returns<
            { group_id: string; user_id: string; profiles: { display_name: string } | null }[]
          >()
      : empty,
    placeIds.length
      ? supabase
          .from("places")
          .select("id, name")
          .in("id", placeIds)
          .returns<{ id: string; name: string }[]>()
      : empty,
  ]);
  for (const r of [invitees, votes, groups, members, places]) {
    if (r.error) {
      console.error("Plans :", r.error.code, r.error.message);
      return {
        ok: false,
        outdated: isOutdated(r.error),
        error: "Impossible de lire les plans. Réessaie.",
      };
    }
  }

  const names = new Map<string, string>();
  const groupMembers = new Map<string, string[]>();
  for (const m of members.data ?? []) {
    names.set(m.user_id, m.profiles?.display_name || "Sans nom");
    groupMembers.set(m.group_id, [...(groupMembers.get(m.group_id) ?? []), m.user_id]);
  }
  // Créateur ou invité qui a quitté le groupe : son profil n'est plus forcément lisible.
  const missing = [
    ...new Set([...rows.map((p) => p.created_by), ...(invitees.data ?? []).map((i) => i.user_id)]),
  ].filter((id) => !names.has(id));
  if (missing.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", missing)
      .returns<{ id: string; display_name: string }[]>();
    for (const p of data ?? []) names.set(p.id, p.display_name || "Sans nom");
    for (const id of missing) if (!names.has(id)) names.set(id, "Ancien membre");
  }

  return {
    ok: true,
    views: buildPlanViews(rows, invitees.data ?? [], votes.data ?? [], {
      myId,
      now,
      names,
      groupNames: new Map((groups.data ?? []).map((g) => [g.id, g.name])),
      placeNames: new Map((places.data ?? []).map((p) => [p.id, p.name])),
      groupMembers,
    }),
  };
}

/** Nombre de plans qui attendent ma réponse (0 en cas d'erreur : c'est un simple badge). */
export async function countAwaitingPlans(
  supabase: SupabaseClient,
  myId: string,
  now: Date,
): Promise<number> {
  const inv = await supabase
    .from("plan_invitees")
    .select(
      "plan_id, meetup_plans!inner(created_by, status, starts_at, ends_at, repeat_unit, repeat_every, repeat_until)",
    )
    .eq("user_id", myId)
    .eq("meetup_plans.status", "proposed")
    .or(notOverFilter(now), { referencedTable: "meetup_plans" })
    .limit(200)
    .returns<
      {
        plan_id: string;
        meetup_plans: Pick<
          PlanRow,
          | "created_by"
          | "status"
          | "starts_at"
          | "ends_at"
          | "repeat_unit"
          | "repeat_every"
          | "repeat_until"
        >;
      }[]
    >();
  if (inv.error || !inv.data?.length) return 0;
  const ids = inv.data.map((i) => i.plan_id);
  const votes = await supabase
    .from("plan_votes")
    .select("plan_id")
    .eq("user_id", myId)
    .in("plan_id", ids)
    .returns<{ plan_id: string }[]>();
  if (votes.error) return 0;
  return countAwaiting(
    inv.data.map((i) => ({ plan_id: i.plan_id, ...i.meetup_plans })),
    votes.data ?? [],
    myId,
    now,
  );
}
