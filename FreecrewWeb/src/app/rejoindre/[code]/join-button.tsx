"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

import { rejoindreGroupe } from "../../groupes/actions";

/** Confirme l'invitation, puis ouvre la page du groupe. */
export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const { t, tr } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await rejoindreGroupe(code);
            if (r.ok) router.push(`/groupes/${r.id}`);
            else setError(r.error);
          });
        }}
      >
        {pending ? t.onboarding.invite.wait : t.onboarding.invite.joinButton}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
