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
import { TIME_ZONE } from "@/lib/scheduling/time";
import { shiftDay } from "@/lib/scheduling/weeklyBlocks";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GroupView, type MemberSchedule } from "./group-view";
import { scheduleLines } from "./schedule-lines";

export const metadata: Metadata = { title: "Groupe · Temps libre commun" };
export const dynamic = "force-dynamic";

/** Jours d'avance pour lesquels on montre les blocs ponctuels. */
const ONE_OFF_DAYS = 14;

export default async function PageGroupe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const plans = await loadPlans(supabase, userId, now, { groupId: group.id });
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
    ),
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <nav aria-label="Fil d'Ariane" className="text-muted-foreground text-sm">
          <Link href="/groupes" className="underline underline-offset-2">
            Mes groupes
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
          plans={plans.ok ? plans.views.filter((p) => p.state !== "cancelled") : null}
          plansError={plans.ok ? null : plans.error}
        />
      </main>
    </>
  );
}
