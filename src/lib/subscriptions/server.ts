import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createKeyedLimiter } from "@/lib/geocoding/rateLimiter";
import { getBusyEvents, listCalendars } from "@/lib/outlook/graph";
import { outlookDeps } from "@/lib/outlook/server";
import { outlookAccessToken, outlookSyncedCalendarId } from "@/lib/outlook/service";

import { fetchCalendarText } from "./safeFetch";
import {
  SUBSCRIPTION_FETCHES_PER_MINUTE,
  type OutlookSource,
  type SubscriptionDeps,
} from "./service";
import { supabaseSubscriptionStore } from "./supabaseStore";

/** Une limite par processus : téléchargements de calendriers, par personne. */
const feedLimiter = createKeyedLimiter({
  limit: SUBSCRIPTION_FETCHES_PER_MINUTE,
  windowMs: 60_000,
});

/**
 * Outlook comme source de calendriers abonnés : `null` si Outlook n'est pas configuré sur le
 * site. Le jeton d'accès est demandé une fois par requête (et compte dans la limite Outlook).
 */
function outlookSource(supabase: SupabaseClient, userId: string): OutlookSource | null {
  const deps = outlookDeps(supabase, userId);
  if (!deps) return null;
  let token: Promise<string> | null = null;
  const access = () => (token ??= outlookAccessToken(deps));
  return {
    async events(calendarId, range) {
      return getBusyEvents(deps.fetch, await access(), calendarId, range, { includeFree: true });
    },
    async calendars() {
      return listCalendars(deps.fetch, await access());
    },
    syncedCalendarId: () => outlookSyncedCalendarId(deps),
  };
}

/** Dépendances réelles du service des calendriers abonnés. */
export function subscriptionDeps(supabase: SupabaseClient, userId: string): SubscriptionDeps {
  return {
    store: supabaseSubscriptionStore(supabase, userId),
    fetchText: (url) => fetchCalendarText(url),
    outlook: outlookSource(supabase, userId),
    userId,
    now: () => new Date(),
    limiter: feedLimiter,
  };
}
