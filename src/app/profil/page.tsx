import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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
import { quietHoursFromDb } from "@/lib/scheduling/quietHours";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PrivacyForm } from "./privacy-form";
import { ProfileForm } from "./profile-form";
import { QuietHoursForm } from "./quiet-hours-form";
import { StudyPrefsForm } from "./study-prefs-form";

export const metadata: Metadata = { title: "Profil · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function Profil() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/profil");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/profil");

  const [profile, places, quietRow, hideTitles, studyPrefs] = await Promise.all([
    getMyProfile(supabase, data.user.id),
    getMyPlaces(supabase, data.user.id),
    getMyQuietHours(supabase, data.user.id),
    getMyPrivacy(supabase, data.user.id),
    getMyStudyPreferences(supabase, data.user.id),
  ]);
  const quiet = quietRow
    ? quietHoursFromDb(quietRow.unavailable_before, quietRow.unavailable_after)
    : null;
  const home = places.find((p) => p.id === profile?.home_place_id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Profil</h1>
        <Card>
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
        <Card>
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
        <Card>
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
        <Card id="etude" className="scroll-mt-16">
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
        <Card>
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
