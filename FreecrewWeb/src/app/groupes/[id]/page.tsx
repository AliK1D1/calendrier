import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { getSiteOrigin } from "@/lib/auth/origin";
import { toBlockSpec } from "@/lib/db/convert";
import { getGroupDetail } from "@/lib/groups/queries";
import { inviteUrl, validateUuid } from "@/lib/groups/validation";
import { loadPlans } from "@/lib/plans/queries";
import { MAX_MEETUP_DURATION } from "@/lib/meetups/search";
import { replanRequest } from "@/lib/plans/replan";
import { MIN_SHORTENED_MINUTES } from "@/lib/scheduling/explainNoMeetup";
import { computePlanReviews, reviewTargets, withReview } from "@/lib/plans/review";
import { TIME_ZONE } from "@/lib/scheduling/time";
import { shiftDay } from "@/lib/scheduling/weeklyBlocks";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GroupView, type MemberSchedule } from "./group-view";
import { scheduleLines } from "./schedule-lines";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.groups.groupMetaTitle };
}
export const dynamic = "force-dynamic";

/** Jours d'avance pour lesquels on montre les blocs ponctuels. */
const ONE_OFF_DAYS = 14;

export default async function PageGroupe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ replanifier?: string | string[] }>;
}) {
  const { id } = await params;
  const { replanifier } = await searchParams;
  const gid = validateUuid(id);
  if (!gid.ok) notFound();

  const supabase = await createSupabaseServerClient();
  const next = encodeURIComponent(`/groupes/${gid.value}`);
  if (!supabase) redirect(`/connexion?erreur=config&next=${next}`);
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/connexion?next=${next}`);
  const userId = data.user.id;

  // Inexistant ou pas membre : même page 404 (on ne révèle pas qu'un groupe existe).
  const group = await getGroupDetail(supabase, gid.value, userId);
  if (!group) notFound();

  const now = new Date();
  const { locale, t, tr } = await getI18n();
  const plans = await loadPlans(supabase, userId, now, { groupId: group.id, locale });
  // Plans « à revoir » : l'horaire du groupe est déjà lu (group.blocks), aucune lecture de plus.
  const planViews = plans.ok
    ? withReview(
        plans.views,
        computePlanReviews(
          reviewTargets(plans.views, now),
          new Map([[group.id, group.blocks]]),
          userId,
          locale,
        ),
      )
    : null;
  // « Trouver un autre moment » (lien d'un plan à revoir) : recherche préremplie.
  const replan = replanRequest(
    planViews ?? [],
    typeof replanifier === "string" ? replanifier : undefined,
    group.members.map((m) => m.userId),
    { min: MIN_SHORTENED_MINUTES, max: MAX_MEETUP_DURATION },
  );
  const today = formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
  const schedules: MemberSchedule[] = group.members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    lines: scheduleLines(
      group.blocks
        .filter((b) => b.owner_id === m.userId)
        .map((b) => ({
          spec: toBlockSpec(b),
          titleHidden: b.title_hidden,
        })),
      group.placeNames,
      { from: today, to: shiftDay(today, ONE_OFF_DAYS) },
      locale,
    ),
  }));

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <nav aria-label={t.groups.breadcrumb} className="text-muted-foreground text-sm">
          <Link href="/groupes" className="underline underline-offset-2">
            {t.common.myGroups}
          </Link>
        </nav>
        <GroupView
          groupId={group.id}
          name={group.name}
          inviteLink={inviteUrl(await getSiteOrigin(), group.inviteCode)}
          myId={userId}
          isAdmin={group.myRole === "admin"}
          members={group.members}
          favorites={group.favorites}
          schedules={schedules}
          plans={planViews ? planViews.filter((p) => p.state !== "cancelled") : null}
          plansError={plans.ok ? null : tr(plans.error)}
          replan={replan}
        />
      </main>
    </>
  );
}
