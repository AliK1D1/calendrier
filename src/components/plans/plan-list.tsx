"use client";

import { useCallback, useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { type Flash, FlashMessage } from "@/components/flash-message";
import type { PlanView } from "@/lib/plans/view";

import { PlanCard } from "./plan-card";
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
  const tp = t.plans;
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<Flash>(null);
  const clear = useCallback(() => setMessage(null), []);
  const { confirm, confirmDialog } = useConfirm();

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
                    ? tp.addedSeries(p.title)
                    : tp.added(p.title)
                  : p.repeatLabel
                    ? tp.leftSeries(p.title)
                    : tp.declinedMsg(p.title),
              )
            }
            onCancel={async () => {
              const series = p.repeatLabel !== null;
              const yes = await confirm({
                message: series ? tp.confirmStopSeries(p.title) : tp.confirmCancel(p.title),
                action: series ? tp.stopSeries : tp.cancelPlan,
              });
              if (yes) {
                run(
                  p.id,
                  () => actions.annuler(p.id, p.groupId),
                  series ? tp.seriesStopped : tp.cancelledMsg,
                );
              }
            }}
          />
        ))}
      </ul>
      <FlashMessage message={message} onClose={clear} />
      {confirmDialog}
    </>
  );
}
