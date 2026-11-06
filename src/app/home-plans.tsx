"use client";

import Link from "next/link";

import { type PlanActions, PlanList } from "@/components/plans/plan-list";
import type { PlanView } from "@/lib/plans/view";
import { useI18n } from "@/lib/i18n/client";

import { annulerPlan, repondrePlan } from "./plans/actions";

const ACTIONS: PlanActions = { repondre: repondrePlan, annuler: annulerPlan };

/** Accueil : plans à répondre, puis mes prochains plans (le reste est dans l'onglet Plans). */
export function HomePlans({
  awaiting,
  upcoming,
  moreUpcoming,
}: {
  awaiting: PlanView[];
  upcoming: PlanView[];
  moreUpcoming: number;
}) {
  const { t } = useI18n();
  if (awaiting.length === 0 && upcoming.length === 0) return null;
  return (
    <>
      {awaiting.length > 0 && (
        <section aria-labelledby="accueil-a-repondre" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="accueil-a-repondre" className="text-lg font-semibold">
              {t.home.plans.awaiting(awaiting.length)}
            </h2>
            <p className="text-muted-foreground text-sm">{t.home.plans.awaitingHint}</p>
          </div>
          <PlanList plans={awaiting} actions={ACTIONS} showGroup />
        </section>
      )}
      {upcoming.length > 0 && (
        <section aria-labelledby="accueil-prochains" className="flex flex-col gap-3">
          <h2 id="accueil-prochains" className="text-lg font-semibold">
            {t.home.plans.upcoming}
          </h2>
          <PlanList plans={upcoming} actions={ACTIONS} showGroup />
          <Link href="/plans" className="text-sm underline underline-offset-2 sm:self-start">
            {t.home.plans.seeAll(moreUpcoming)}
          </Link>
        </section>
      )}
    </>
  );
}
