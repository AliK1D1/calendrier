import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { getMyPlaces, getMyProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PlacesManager } from "./places-manager";

export const metadata: Metadata = { title: "Mes lieux · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function MesLieux() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/lieux");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/lieux");

  const [profile, places] = await Promise.all([
    getMyProfile(supabase, data.user.id),
    getMyPlaces(supabase, data.user.id),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Mes lieux</h1>
          <p className="text-muted-foreground text-sm">
            Ta maison, ton cégep, ton travail… L&apos;app s&apos;en sert pour calculer tes temps de
            trajet. Les membres de tes groupes voient ces lieux.
          </p>
        </header>
        <PlacesManager places={places} homeId={profile?.home_place_id ?? null} />
      </main>
    </>
  );
}
