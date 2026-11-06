"use client";

import Link from "next/link";

import { type PlanActions, PlanList } from "@/components/plans/plan-list";
import { groupPlans, type PlanView } from "@/lib/plans/view";

import { annulerPlan, repondrePlan } from "./actions";
import { useI18n } from "@/lib/i18n/client";

const DEFAULT_ACTIONS: PlanActions = { repondre: repondrePlan, annuler: annulerPlan };

/** Contenu de « Mes plans » (actions remplaçables pour une page de démonstration). */
export function PlansView({
  plans,
  actions = DEFAULT_ACTIONS,
}: {
  plans: PlanView[];
  actions?: PlanActions;
}) {
  const { t } = useI18n();
  const tp = t.plans;
  const { awaiting, upcoming, others, past } = groupPlans(plans);
  if (plans.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        {tp.emptyBefore}
        <Link href="/groupes" className="underline underline-offset-2">
          {tp.emptyLink}
        </Link>
        {tp.emptyAfter}
      </p>
    );
  }
  const sections: { id: string; title: string; hint?: string; list: PlanView[] }[] = [
    {
      id: "en-attente",
      title: tp.sections.awaiting,
      hint: tp.sections.awaitingHint,
      list: awaiting,
    },
    {
      id: "a-venir",
      title: tp.sections.upcoming,
      hint: tp.sections.upcomingHint,
      list: upcoming,
    },
    {
      id: "autres",
      title: tp.sections.others,
      hint: tp.sections.othersHint,
      list: others,
    },
    { id: "passes", title: tp.sections.past, list: past },
  ];
  return (
    <div className="flex flex-col gap-6">
      {sections
        .filter((s) => s.list.length > 0 || s.id === "en-attente")
        .map((s) => (
          <section key={s.id} aria-labelledby={s.id} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 id={s.id} className="text-lg font-semibold">
                {s.title}
                {s.list.length > 0 && (
                  <span className="text-muted-foreground text-sm font-normal">
                    {" "}
                    · {s.list.length}
                  </span>
                )}
              </h2>
              {s.hint && s.list.length > 0 && (
                <p className="text-muted-foreground text-sm">{s.hint}</p>
              )}
            </div>
            {s.list.length === 0 ? (
              <p className="text-muted-foreground text-sm">{tp.nothingToAnswer}</p>
            ) : (
              <PlanList plans={s.list} actions={actions} showGroup />
            )}
          </section>
        ))}
      <p className="text-muted-foreground text-xs">{tp.footer(plans.length)}</p>
    </div>
  );
}
