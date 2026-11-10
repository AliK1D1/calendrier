import { formatDistanceStrict } from "date-fns";
import { frCA } from "date-fns/locale";
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
  getMyQuietHours,
  getMyStudyPreferences,
} from "@/lib/profile";
import { getOutlookConfig } from "@/lib/outlook/config";
import { getOutlookStatus } from "@/lib/outlook/supabaseStore";
import { SUBSCRIPTION_MAX_PER_USER } from "@/lib/scheduling/subscriptions";
import { getMySubscriptions } from "@/lib/subscriptions/supabaseStore";
import { quietHoursFromDb } from "@/lib/scheduling/quietHours";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AppearanceForm } from "./appearance-form";
import { PrivacyForm } from "./privacy-form";
import { OutlookCard } from "./outlook-card";
import { ProfileForm } from "./profile-form";
import { QuietHoursForm } from "./quiet-hours-form";
import { StudyPrefsForm } from "./study-prefs-form";
import { SubscriptionsCard } from "./subscriptions-card";

export const metadata: Metadata = { title: "Profil · Temps libre commun" };
export const dynamic = "force-dynamic";
// Actions Outlook (synchro, choix du calendrier) : Microsoft peut être lent.
export const maxDuration = 60;

/** Message au retour de Microsoft (`/profil?outlook=…`). */
const OUTLOOK_RETURN: Record<string, { ok: boolean; text: string }> = {
  connecte: { ok: true, text: "Outlook connecté et synchronisé." },
  "connecte-erreur": {
    ok: false,
    text: "Outlook est connecté, mais la première synchro n'a pas fonctionné (voir ci-dessus).",
  },
  refuse: { ok: false, text: "Connexion à Outlook annulée." },
  expire: { ok: false, text: "La connexion à Outlook a expiré. Recommence." },
  echec: { ok: false, text: "La connexion à Outlook n'a pas fonctionné. Réessaie." },
  "non-configure": { ok: false, text: "Outlook n'est pas encore configuré sur ce site." },
};

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

  const [profile, places, quietRow, hideTitles, studyPrefs, outlookStatus, subscriptions] =
    await Promise.all([
      getMyProfile(supabase, data.user.id),
      getMyPlaces(supabase, data.user.id),
      getMyQuietHours(supabase, data.user.id),
      getMyPrivacy(supabase, data.user.id),
      getMyStudyPreferences(supabase, data.user.id),
      getOutlookStatus(supabase, data.user.id),
      getMySubscriptions(supabase, data.user.id),
    ]);
  const now = new Date();
  const ago = (at: string | null) =>
    at ? formatDistanceStrict(new Date(at), now, { addSuffix: true, locale: frCA }) : null;
  const quiet = quietRow
    ? quietHoursFromDb(quietRow.unavailable_before, quietRow.unavailable_after)
    : null;
  const home = places.find((p) => p.id === profile?.home_place_id);

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <h1 className="titre-page">Profil</h1>
        <PageSections
          items={[
            { id: "toi", label: "Toi" },
            { id: "heures", label: "Heures où je ne sors pas" },
            { id: "confidentialite", label: "Confidentialité" },
            { id: "outlook", label: "Outlook" },
            { id: "abonnements", label: "Calendriers en ligne" },
            { id: "etude", label: "Étude" },
            { id: "apparence", label: "Apparence" },
            { id: "maison", label: "Maison et déconnexion" },
          ]}
        />
        <Card id="toi" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>Toi</CardTitle>
            <CardDescription>
              Ton mode de transport sert à estimer tes temps de trajet. Connecté en tant que{" "}
              {data.user.email ?? "utilisateur"}.
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
            <CardTitle>Heures où je ne sors pas</CardTitle>
            <CardDescription>
              L&apos;app ne te proposera rien en dehors de ces heures : elles comptent comme du
              temps occupé à la maison, tous les jours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {quiet ? (
              <QuietHoursForm before={quiet.before} after={quiet.after} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                La base de données n&apos;est pas à jour : applique supabase/migration-0004.sql
                (voir README).
              </p>
            )}
          </CardContent>
        </Card>
        <Card id="confidentialite" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>Confidentialité</CardTitle>
            <CardDescription>
              Ce que les membres de tes groupes voient de ton horaire. Ton nom et tes lieux restent
              visibles pour qu&apos;on puisse calculer les trajets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hideTitles === null ? (
              <p role="alert" className="text-destructive text-sm">
                La base de données n&apos;est pas à jour : applique supabase/migration-0006.sql
                (voir README).
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
                        locale: frCA,
                      })
                    : null,
                  lastSyncError: outlookStatus.lastSyncError,
                }
              : null
          }
          returnMessage={typeof outlook === "string" ? (OUTLOOK_RETURN[outlook] ?? null) : null}
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
            <CardTitle>Préférences d&apos;étude</CardTitle>
            <CardDescription>
              Pour les séances que l&apos;app te propose avant un examen ou un travail (page Étude).
              Les séances ont lieu dans ces heures, et jamais pendant tes heures où tu ne sors pas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {studyPrefs ? (
              <StudyPrefsForm prefs={studyPrefs} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                La base de données n&apos;est pas à jour : applique supabase/migration-0011.sql
                (voir README).
              </p>
            )}
          </CardContent>
        </Card>
        <Card id="apparence" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>Apparence</CardTitle>
            <CardDescription>
              Mode clair ou sombre, et la couleur des boutons. Le changement se voit tout de suite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceForm />
          </CardContent>
        </Card>
        <Card id="maison" className="scroll-mt-32">
          <CardHeader>
            <CardTitle>Maison</CardTitle>
            <CardDescription>
              {home ? `Ta maison : ${home.name}.` : "Tu n'as pas encore choisi ta maison."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/lieux">Gérer mes lieux</Link>
            </Button>
            <form action="/auth/deconnexion" method="post">
              <Button type="submit" variant="ghost">
                Se déconnecter
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
