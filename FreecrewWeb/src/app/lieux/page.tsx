import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { getMyPlaces, getMyProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PlacesManager } from "./places-manager";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.places.metaTitle };
}
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

  const { t } = await getI18n();
  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="titre-page">{t.places.title}</h1>
          <p className="text-muted-foreground text-sm">{t.places.intro}</p>
        </header>
        <PlacesManager places={places} homeId={profile?.home_place_id ?? null} />
      </main>
    </>
  );
}
