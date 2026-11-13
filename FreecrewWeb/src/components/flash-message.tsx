"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect } from "react";

import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type Flash = { type: "ok" | "erreur"; text: string } | null;

/** Délai avant de cacher un message de réussite (une erreur reste jusqu'à ce qu'on la ferme). */
const OK_MS = 6000;

/**
 * Message de retour après une action (« Lieu supprimé. », une erreur…), affiché en bas de
 * l'écran. Sur un téléphone, un message placé en haut de la page passait inaperçu quand le
 * bouton cliqué était plus bas (supprimer un lieu favori, retirer un membre…).
 */
export function FlashMessage({ message, onClose }: { message: Flash; onClose: () => void }) {
  const { t, tr } = useI18n();
  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(onClose, OK_MS);
    return () => clearTimeout(t);
  }, [message, onClose]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--barre-onglets)] z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-0"
    >
      {message && (
        <p
          role={message.type === "erreur" ? "alert" : "status"}
          className={cn(
            "bg-popover text-popover-foreground shadow-flottant pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border p-3 text-sm font-medium",
            message.type === "erreur" ? "border-destructive/50" : "border-success/50",
          )}
        >
          {message.type === "erreur" ? (
            <CircleAlert className="text-destructive mt-px size-5 shrink-0" aria-hidden />
          ) : (
            <CircleCheck className="text-success mt-px size-5 shrink-0" aria-hidden />
          )}
          <span className="flex-1">{tr(message.text)}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.closeMessage}
            className="text-muted-foreground hover:text-foreground -my-2.5 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-md"
          >
            <X className="size-4" />
          </button>
        </p>
      )}
    </div>
  );
}
