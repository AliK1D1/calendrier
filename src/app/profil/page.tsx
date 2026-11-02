import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyPlaces, getMyProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profil · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function Profil() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/profil");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/profil");

  const [profile, places] = await Promise.all([
    getMyProfile(supabase, data.user.id),
    getMyPlaces(supabase, data.user.id),
  ]);
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
