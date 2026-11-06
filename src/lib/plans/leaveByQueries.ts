import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type PlaceInput, toPlace } from "@/lib/db/convert";
import { getTransitRouter, getTravelProvider } from "@/lib/travel/server";

import { computeLeaveBy, type LeaveByBlock, leaveByTargets, withLeaveBy } from "./leaveBy";
import type { PlanView } from "./view";

const BLOCK_COLUMNS =
  "id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, meetup_plan_id";

/**
 * Story 6 : ajoute « Pars de … à HH:MM » à mes prochains plans en personne. Lit, au nom de la
 * personne connectée (RLS), SON profil, SES blocs et les lieux nécessaires (les siens et ceux
 * des plans). En cas d'erreur, les plans sont rendus tels quels (la page s'affiche quand même).
 */
export async function addLeaveBy(
  supabase: SupabaseClient,
  myId: string,
  views: PlanView[],
  now: Date,
): Promise<PlanView[]> {
  const targets = leaveByTargets(views, now);
  if (targets.length === 0) return views;
  try {
    const [profile, blocks] = await Promise.all([
      supabase.from("profiles").select("home_place_id, travel_mode").eq("id", myId).maybeSingle<{
        home_place_id: string | null;
        travel_mode: "walk" | "bike" | "transit" | "car";
      }>(),
      supabase
        .from("busy_blocks")
        .select(BLOCK_COLUMNS)
        .eq("owner_id", myId)
        .limit(2000)
        .returns<LeaveByBlock[]>(),
    ]);
    if (profile.error || blocks.error) {
      const e = profile.error ?? blocks.error;
      console.error("Heure de départ :", e?.code, e?.message);
      return views;
    }
    const home = profile.data?.home_place_id;
    if (!home || !profile.data) return views;

    const placeIds = new Set<string>([home, ...targets.map((t) => t.placeId)]);
    for (const b of blocks.data ?? []) if (b.place_id) placeIds.add(b.place_id);
    const places = await supabase
      .from("places")
      .select("id, owner_id, name, lat, lng")
      .in("id", [...placeIds])
      .returns<PlaceInput[]>();
    if (places.error) {
      console.error("Heure de départ :", places.error.code, places.error.message);
      return views;
    }

    const leaveBy = await computeLeaveBy(
      targets,
      {
        homePlaceId: home,
        travelMode: profile.data.travel_mode,
        blocks: blocks.data ?? [],
        places: (places.data ?? []).map(toPlace),
      },
      {
        travel: getTravelProvider(),
        transit: getTransitRouter(),
        budgetKey: myId,
        now,
      },
    );
    return withLeaveBy(views, leaveBy);
  } catch (e) {
    console.error("Heure de départ :", e);
    return views;
  }
}
