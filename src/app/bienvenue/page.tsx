import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/paths";
import { getI18n } from "@/lib/i18n/server";
import { getMyProfile, getOnboardingStatus } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.onboarding.metaTitle };
}
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
  const { t } = await getI18n();

  return (
    <main className="grille-4 mx-auto min-h-dvh max-w-xl content-start gap-y-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t.onboarding.title}</h1>
        <p className="text-muted-foreground">{t.onboarding.intro}</p>
      </header>
      <OnboardingForm next={next} initialMode={profile?.travel_mode ?? "transit"} />
    </main>
  );
}
