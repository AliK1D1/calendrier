import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CalendarSearch, Check, ChevronRight } from "lucide-react";
import Link from "next/link";

import { FreeNow } from "@/components/free-now";
import { LogoMark } from "@/components/logo-mark";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyGroups } from "@/lib/groups/queries";
import { addLeaveBy } from "@/lib/plans/leaveByQueries";
import { loadPlans } from "@/lib/plans/queries";
import { getMyBusyBlocks, getMyProfile, getOnboardingStatus } from "@/lib/profile";
import { getI18n } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { homePlans } from "@/lib/ux/homePlans";
import { setupSteps } from "@/lib/ux/setupSteps";

import { HomePlans } from "./home-plans";

// Toujours rendu à la demande : l'affichage dépend de la session.
export const dynamic = "force-dynamic";

export default async function Accueil() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (supabase && user) return <AccueilConnecte supabase={supabase} user={user} />;
  const { t } = await getI18n();

  return (
    <main className="grille-4 mx-auto min-h-dvh max-w-3xl content-start gap-y-8 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-3">
        <LogoMark className="size-10 rounded-xl [&>svg]:size-5" />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t.common.appName}</h1>
        <p className="text-muted-foreground text-lg">{t.home.intro}</p>
      </header>

      <div>
        <Button asChild size="lg">
          <Link href="/connexion">{t.home.signIn}</Link>
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t.home.howItWorks}>
        {t.home.pitch.map((etape, i) => (
          <Card key={etape.title}>
            <CardHeader>
              <span
                aria-hidden
                className="bg-primary/10 text-primary mb-2 flex size-8 items-center justify-center rounded-full text-sm font-semibold"
              >
                {i + 1}
              </span>
              <CardTitle>
                <span className="sr-only">{i + 1}. </span>
                {etape.title}
              </CardTitle>
              <CardDescription>{etape.text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}

/**
 * Accueil d'une personne connectée : la prochaine chose à faire (au lieu de la page de
 * présentation), puis des raccourcis vers ses groupes.
 */
async function AccueilConnecte({ supabase, user }: { supabase: SupabaseClient; user: User }) {
  const now = new Date();
  const { locale, t } = await getI18n();
  const [onboarded, profile, blocks, groups, plans] = await Promise.all([
    getOnboardingStatus(supabase),
    getMyProfile(supabase, user.id),
    getMyBusyBlocks(supabase, user.id),
    getMyGroups(supabase, user.id),
    loadPlans(supabase, user.id, now, { locale }).then(async (r) =>
      // Story 6 : « Pars de … à HH:MM » sur mes prochains plans en personne.
      r.ok ? { ...r, views: await addLeaveBy(supabase, user.id, r.views, now, locale) } : r,
    ),
  ]);
  // Plans illisibles (ex. migration absente) : l'accueil s'affiche quand même, sans eux.
  const myPlans = homePlans(plans.ok ? plans.views : []);
  const plan = setupSteps({
    onboarded,
    hasHome: Boolean(profile?.home_place_id),
    blockCount: blocks.length,
    groups,
  });
  const ready = plan.next?.id === "moment";
  const prenom = profile?.display_name?.trim();

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight break-words">{t.home.hello(prenom)}</h1>
          <p className="text-muted-foreground text-sm">
            {ready ? t.home.ready : t.home.progress(plan.doneCount)}
          </p>
        </header>

        {ready && plan.next && (
          <Button asChild size="lg" className="sm:justify-self-start">
            <Link href={plan.next.href}>
              <CalendarSearch /> {t.home.findMoment}
            </Link>
          </Button>
        )}

        <HomePlans {...myPlans} />

        {/* Bonus « Je suis libre maintenant » : dès qu'un groupe compte au moins un ami. */}
        {profile?.home_place_id && groups.some((g) => g.memberCount >= 2) && <FreeNow />}

        {!ready && (
          <Card>
            <CardHeader>
              <CardTitle>{t.home.gettingStarted}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2">
                {plan.steps
                  .filter((s) => s.id !== "moment")
                  .map((s, i) => {
                    const isNext = plan.next?.id === s.id;
                    return (
                      <li key={s.id}>
                        <Link
                          href={s.href}
                          aria-current={isNext ? "step" : undefined}
                          className={cn(
                            "bg-card hover:bg-accent flex items-center gap-3 rounded-lg border p-3",
                            isNext && "border-primary bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                              s.done && "border-success bg-success text-success-foreground",
                            )}
                            aria-hidden
                          >
                            {s.done ? <Check className="size-4" /> : i + 1}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className={cn("font-medium", s.done && "text-muted-foreground")}>
                              {t.home.steps[s.id].title}
                              <span className="sr-only">
                                {s.done ? t.home.stepDone : t.home.stepTodo}
                              </span>
                            </span>
                            {!s.done && (
                              <span className="text-muted-foreground text-xs">
                                {s.groupName
                                  ? t.home.momentHint(s.groupName)
                                  : t.home.steps[s.id].hint}
                              </span>
                            )}
                          </span>
                          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                        </Link>
                      </li>
                    );
                  })}
              </ol>
            </CardContent>
          </Card>
        )}

        {groups.length > 0 && (
          <section aria-labelledby="mes-groupes" className="flex flex-col gap-3">
            <h2 id="mes-groupes" className="text-lg font-semibold">
              {t.home.myGroups}
            </h2>
            <ul className="flex flex-col gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/groupes/${g.id}${g.memberCount >= 2 ? "#se-voir" : "#inviter"}`}
                    className="bg-card hover:bg-accent flex items-center gap-3 rounded-lg border p-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium break-words">{g.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {g.memberCount >= 2
                          ? t.home.groupMembers(g.memberCount)
                          : t.home.groupAlone}
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="text-muted-foreground flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
          <span className="break-all">
            {t.home.signedInAs} <strong>{user.email ?? t.home.user}</strong>
          </span>
          <form action="/auth/deconnexion" method="post">
            <Button type="submit" variant="ghost" size="sm">
              {t.home.signOut}
            </Button>
          </form>
        </footer>
      </main>
    </>
  );
}
