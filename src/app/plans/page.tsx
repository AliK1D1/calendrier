import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { loadPlans } from "@/lib/plans/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PlansView } from "./plans-view";

export const metadata: Metadata = { title: "Mes plans · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function MesPlans() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/plans");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/plans");

  const plans = await loadPlans(supabase, data.user.id, new Date());

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Mes plans</h1>
          <p className="text-muted-foreground text-sm">
            Les moments proposés dans tes groupes. Accepte ou refuse ceux où tu es invité·e : tu
            peux changer d&apos;avis tant que le moment n&apos;est pas passé.
          </p>
        </header>
        {plans.ok ? (
          <PlansView plans={plans.views} />
        ) : (
          <p
            role="alert"
            className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
          >
            {plans.error}
          </p>
        )}
      </main>
    </>
  );
}
