"use client";

import Link from "next/link";

import { type PlanActions, PlanList } from "@/components/plans/plan-list";
import type { PlanView } from "@/lib/plans/view";
import { plural } from "@/lib/ux/plural";

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
  if (awaiting.length === 0 && upcoming.length === 0) return null;
  return (
    <>
      {awaiting.length > 0 && (
        <section aria-labelledby="accueil-a-repondre" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="accueil-a-repondre" className="text-lg font-semibold">
              {awaiting.length > 1
                ? `${awaiting.length} plans attendent ta réponse`
                : "Un plan attend ta réponse"}
            </h2>
            <p className="text-muted-foreground text-sm">
              Si tu acceptes, le moment s&apos;ajoute à ton horaire.
            </p>
          </div>
          <PlanList plans={awaiting} actions={ACTIONS} showGroup />
        </section>
      )}
      {upcoming.length > 0 && (
        <section aria-labelledby="accueil-prochains" className="flex flex-col gap-3">
          <h2 id="accueil-prochains" className="text-lg font-semibold">
            Tes prochains plans
          </h2>
          <PlanList plans={upcoming} actions={ACTIONS} showGroup />
          <Link href="/plans" className="text-sm underline underline-offset-2 sm:self-start">
            {moreUpcoming > 0
              ? `Voir tous mes plans (${plural(moreUpcoming, "autre")})`
              : "Voir tous mes plans"}
          </Link>
        </section>
      )}
    </>
  );
}
