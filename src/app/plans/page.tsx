import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { addLeaveBy } from "@/lib/plans/leaveByQueries";
import { loadPlans } from "@/lib/plans/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PlansView } from "./plans-view";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.plans.metaTitle };
}
export const dynamic = "force-dynamic";

export default async function MesPlans() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/plans");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/plans");

  const now = new Date();
  const { locale, t, tr } = await getI18n();
  const plans = await loadPlans(supabase, data.user.id, now, { locale });
  // Story 6 : « Pars de … à HH:MM » sur mes prochains plans en personne.
  const views = plans.ok ? await addLeaveBy(supabase, data.user.id, plans.views, now, locale) : [];

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="titre-page">{t.plans.title}</h1>
          <p className="text-muted-foreground text-sm">{t.plans.intro}</p>
        </header>
        {plans.ok ? (
          <PlansView plans={views} />
        ) : (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/8 text-destructive rounded-lg border p-3 text-sm"
          >
            {tr(plans.error)}
          </p>
        )}
      </main>
    </>
  );
}
