"use client";

import { useCallback, useState, useTransition } from "react";

import { type Flash, FlashMessage } from "@/components/flash-message";
import type { PlanView } from "@/lib/plans/view";

import { PlanCard } from "./plan-card";

type Result = { ok: true } | { ok: false; error: string };

/** Actions des plans (actions serveur dans l'app ; remplaçables pour une page de démo). */
export interface PlanActions {
  repondre: (planId: unknown, accept: unknown, groupId?: unknown) => Promise<Result>;
  annuler: (planId: unknown, groupId?: unknown) => Promise<Result>;
}

/** Liste de plans avec les boutons de réponse ; messages en bas de l'écran. */
export function PlanList({
  plans,
  actions,
  showGroup,
}: {
  plans: PlanView[];
  actions: PlanActions;
  showGroup?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<Flash>(null);
  const clear = useCallback(() => setMessage(null), []);

  function run(id: string, action: () => Promise<Result>, ok: string) {
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const r = await action();
      setMessage(r.ok ? { type: "ok", text: ok } : { type: "erreur", text: r.error });
      setBusyId(null);
    });
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            showGroup={showGroup}
            pending={pending && busyId === p.id}
            onRespond={(accept) =>
              run(
                p.id,
                () => actions.repondre(p.id, accept, p.groupId),
                accept
                  ? p.repeatLabel
                    ? `« ${p.title} » est ajouté à ton horaire, chaque fois.`
                    : `« ${p.title} » est ajouté à ton horaire.`
                  : p.repeatLabel
                    ? `Tu ne fais plus partie de « ${p.title} ». La série n'est plus dans ton horaire.`
                    : `Tu as refusé « ${p.title} ». Il n'est pas dans ton horaire.`,
              )
            }
            onCancel={() => {
              const series = p.repeatLabel !== null;
              if (
                window.confirm(
                  series
                    ? `Arrêter la série « ${p.title} » pour tout le monde ? Elle sera retirée de l'horaire de tous ceux qui l'avaient acceptée. (Pour la quitter toi seul·e, touche plutôt « Quitter la série ».)`
                    : `Annuler « ${p.title} » ? Il sera retiré de l'horaire de tous ceux qui l'avaient accepté.`,
                )
              ) {
                run(
                  p.id,
                  () => actions.annuler(p.id, p.groupId),
                  series ? "Série arrêtée pour tout le monde." : "Plan annulé.",
                );
              }
            }}
          />
        ))}
      </ul>
      <FlashMessage message={message} onClose={clear} />
    </>
  );
}
