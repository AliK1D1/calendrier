import { formatDistanceStrict } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageSections } from "@/components/page-sections";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMyPlaces,
  getMyPrivacy,
  getMyProfile,
  getMyOutingLimits,
  getMyQuietHours,
  getMyStudyPreferences,
} from "@/lib/profile";
import { getOutlookConfig } from "@/lib/outlook/config";
import { getOutlookStatus } from "@/lib/outlook/supabaseStore";
import { SUBSCRIPTION_MAX_PER_USER } from "@/lib/scheduling/subscriptions";
import { getMySubscriptions } from "@/lib/subscriptions/supabaseStore";
import { dateFnsLocale } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { outingLimitsFromDb } from "@/lib/scheduling/outingLimits";
import { quietHoursFromDb } from "@/lib/scheduling/quietHours";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AppearanceForm } from "./appearance-form";
import { PrivacyForm } from "./privacy-form";
import { OutingLimitsForm } from "./outing-limits-form";
import { OutlookCard } from "./outlook-card";
import { ProfileForm } from "./profile-form";
import { QuietHoursForm } from "./quiet-hours-form";
import { StudyPrefsForm } from "./study-prefs-form";
import { SubscriptionsCard } from "./subscriptions-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.profile.metaTitle };
}

export const dynamic = "force-dynamic";
// Actions Outlook (synchro, choix du calendrier) : Microsoft peut être lent.
export const maxDuration = 60;

/** Message au retour de Microsoft (`/profil?outlook=…`) ; seul « connecte » est un succès. */
function outlookReturn(
  code: string | string[] | undefined,
  texts: Readonly<Record<string, string>>,
): { ok: boolean; text: string } | null {
  if (typeof code !== "string" || !Object.hasOwn(texts, code)) return null;
  return { ok: code === "connecte", text: texts[code] };
}

export default async function Profil({
  searchParams,
}: {
  searchParams: Promise<{ outlook?: string | string[] }>;
}) {
  const { outlook } = await searchParams;
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/profil");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/profil");

  const { locale, t } = await getI18n();
  const tp = t.profile;
  const [
    profile,
    places,
    quietRow,
    hideTitles,
    studyPrefs,
    outlookStatus,
    subscriptions,
    outingRow,
  ] = await Promise.all([
    getMyProfile(supabase, data.user.id),
    getMyPlaces(supabase, data.user.id),
    getMyQuietHours(supabase, data.user.id),
    getMyPrivacy(supabase, data.user.id),
    getMyStudyPreferences(supabase, data.user.id),
    getOutlookStatus(supabase, data.user.id),
    getMySubscriptions(supabase, data.user.id),
    getMyOutingLimits(supabase, data.user.id),
  ]);
  const outingLimits = outingLimitsFromDb(
    outingRow?.max_outings_per_day,
    outingRow?.max_outings_per_week,
  );
  const now = new Date();
  const ago = (at: string | null) =>
    at
      ? formatDistanceStrict(new Date(at), now, { addSuffix: true, locale: dateFnsLocale(locale) })
      : null;
  const quiet = quietRow
    ? quietHoursFromDb(quietRow.unavailable_before, quietRow.unavailable_after)
    : null;
  const home = places.find((p) => p.id === profile?.home_place_id);

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <h1 className="titre-page">{tp.title}</h1>
        <PageSections
          items={[
            { id: "toi", label: tp.sections.you },
            { id: "heures", label: tp.sections.quiet },
            { id: "sorties", label: t.plans.outingLimit.title },
            { id: "confidentialite", label: tp.sections.privacy },
            { id: "outlook", label: tp.sections.outlook },
            { id: "abonnements", label: tp.sections.subscriptions },
            { id: "etude", label: tp.sections.study },
            { id: "apparence", label: tp.sections.appearance },
            { id: "maison", label: tp.sections.home },
          ]}
        />
        <Card id="toi" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.you.title}</CardTitle>
            <CardDescription>
              {tp.you.description(data.user.email ?? tp.you.fallbackUser)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              displayName={profile?.display_name ?? ""}
              travelMode={profile?.travel_mode ?? "transit"}
            />
          </CardContent>
        </Card>
        <Card id="heures" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.quiet.title}</CardTitle>
            <CardDescription>{tp.quiet.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {quiet ? (
              <QuietHoursForm before={quiet.before} after={quiet.after} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                {tp.dbOutdated("0004")}
              </p>
            )}
          </CardContent>
        </Card>
        <Card id="sorties" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{t.plans.outingLimit.title}</CardTitle>
            <CardDescription>{t.plans.outingLimit.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {outingRow ? (
              <OutingLimitsForm perDay={outingLimits.perDay} perWeek={outingLimits.perWeek} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                {t.plans.outingLimit.outdated}
              </p>
            )}
          </CardContent>
        </Card>
        <Card id="confidentialite" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.privacy.title}</CardTitle>
            <CardDescription>{tp.privacy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {hideTitles === null ? (
              <p role="alert" className="text-destructive text-sm">
                {tp.dbOutdated("0006")}
              </p>
            ) : (
              <PrivacyForm hideTitles={hideTitles} />
            )}
          </CardContent>
        </Card>
        <OutlookCard
          configured={getOutlookConfig() !== null}
          dbReady={outlookStatus !== "absent"}
          status={
            outlookStatus && outlookStatus !== "absent"
              ? {
                  accountEmail: outlookStatus.accountEmail,
                  calendarName: outlookStatus.calendarName,
                  lastSynced: outlookStatus.lastSyncedAt
                    ? formatDistanceStrict(new Date(outlookStatus.lastSyncedAt), now, {
                        addSuffix: true,
                        locale: dateFnsLocale(locale),
                      })
                    : null,
                  lastSyncError: outlookStatus.lastSyncError,
                }
              : null
          }
          returnMessage={outlookReturn(outlook, tp.outlook.returns)}
        />
        <SubscriptionsCard
          dbReady={subscriptions !== "absent"}
          items={
            subscriptions === "absent"
              ? []
              : subscriptions.map((s) => ({
                  id: s.id,
                  kind: s.kind,
                  name: s.name,
                  source: s.source,
                  countsAsBusy: s.countsAsBusy,
                  lastSynced: ago(s.lastSyncedAt),
                  lastSyncError: s.lastSyncError,
                }))
          }
          outlookConnected={
            getOutlookConfig() !== null && !!outlookStatus && outlookStatus !== "absent"
          }
          max={SUBSCRIPTION_MAX_PER_USER}
        />
        <Card id="etude" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.study.title}</CardTitle>
            <CardDescription>{tp.study.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {studyPrefs ? (
              <StudyPrefsForm prefs={studyPrefs} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                {tp.dbOutdated("0011")}
              </p>
            )}
          </CardContent>
        </Card>
        <Card id="apparence" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.appearance.title}</CardTitle>
            <CardDescription>{tp.appearance.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceForm />
          </CardContent>
        </Card>
        <Card id="maison" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>{tp.home.title}</CardTitle>
            <CardDescription>{home ? tp.home.yourHome(home.name) : tp.home.noHome}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/lieux">{tp.home.managePlaces}</Link>
            </Button>
            <form action="/auth/deconnexion" method="post">
              <Button type="submit" variant="ghost">
                {tp.home.signOut}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
