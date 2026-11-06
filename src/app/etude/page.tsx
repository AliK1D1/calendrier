import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { requiredMinutes } from "@/lib/scheduling/studyPlanner";
import { TIME_ZONE } from "@/lib/scheduling/time";
import { getTravelProvider } from "@/lib/travel/server";
import { studyOverview } from "@/lib/study/service";
import { supabaseStudyStore } from "@/lib/study/supabaseStore";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { StudyView } from "./study-view";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.study.metaTitle };
}
export const dynamic = "force-dynamic";

export default async function Etude() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/etude");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/etude");
  const userId = data.user.id;
  const now = new Date();
  const { locale, t, tr } = await getI18n();

  const overview = await studyOverview(
    supabaseStudyStore(supabase, userId),
    { userId, now, travel: getTravelProvider(), locale },
    requiredMinutes,
  );

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t.study.title}</h1>
          <p className="text-muted-foreground text-sm">{t.study.intro}</p>
        </header>
        {overview.ok ? (
          <StudyView
            overview={overview.value}
            today={formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd")}
          />
        ) : (
          <p
            role="alert"
            className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
          >
            {tr(overview.error)}
          </p>
        )}
      </main>
    </>
  );
}
