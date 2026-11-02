import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/paths";
import { getMyProfile, getOnboardingStatus } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Bienvenue · Temps libre commun" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Bienvenue({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  let next = safeNextPath(rawNext);
  if (next.startsWith("/bienvenue")) next = "/";

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/connexion?next=${encodeURIComponent("/bienvenue")}`);

  // Déjà fait : rien à demander.
  if ((await getOnboardingStatus(supabase)) === true) redirect(next);
  const profile = await getMyProfile(supabase, data.user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Bienvenue !</h1>
        <p className="text-muted-foreground">
          Trois questions pour que l&apos;app calcule des trajets réalistes. Tu pourras tout changer
          plus tard dans « Mes lieux » et « Profil ».
        </p>
      </header>
      <OnboardingForm next={next} initialMode={profile?.travel_mode ?? "transit"} />
    </main>
  );
}
