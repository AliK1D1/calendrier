"use client";

import Link from "next/link";

import { type PlanActions, PlanList } from "@/components/plans/plan-list";
import { groupPlans, type PlanView } from "@/lib/plans/view";
import { plural } from "@/lib/ux/plural";

import { annulerPlan, repondrePlan } from "./actions";

const DEFAULT_ACTIONS: PlanActions = { repondre: repondrePlan, annuler: annulerPlan };

/** Contenu de « Mes plans » (actions remplaçables pour une page de démonstration). */
export function PlansView({
  plans,
  actions = DEFAULT_ACTIONS,
}: {
  plans: PlanView[];
  actions?: PlanActions;
}) {
  const { awaiting, upcoming, others, past } = groupPlans(plans);
  if (plans.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        Aucun plan pour l&apos;instant. Dans un{" "}
        <Link href="/groupes" className="underline underline-offset-2">
          groupe
        </Link>
        , cherche « Quand on peut se voir » puis touche « Proposer ce moment ».
      </p>
    );
  }
  const sections: { id: string; title: string; hint?: string; list: PlanView[] }[] = [
    {
      id: "en-attente",
      title: "En attente de ta réponse",
      hint: "Si tu acceptes, le moment s'ajoute à ton horaire.",
      list: awaiting,
    },
    {
      id: "a-venir",
      title: "À venir",
      hint: "Les plans que tu as acceptés ou proposés.",
      list: upcoming,
    },
    {
      id: "autres",
      title: "Autres plans de tes groupes",
      hint: "Refusés, ou auxquels tu n'es pas invité·e.",
      list: others,
    },
    { id: "passes", title: "Passés et annulés", list: past },
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
              <p className="text-muted-foreground text-sm">Rien à répondre pour l&apos;instant.</p>
            ) : (
              <PlanList plans={s.list} actions={actions} showGroup />
            )}
          </section>
        ))}
      <p className="text-muted-foreground text-xs">
        {plural(plans.length, "plan")} dans tes groupes (les plans passés depuis plus de 60 jours ne
        sont plus affichés).
      </p>
    </div>
  );
}
