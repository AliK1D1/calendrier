"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

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
  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(onClose, OK_MS);
    return () => clearTimeout(t);
  }, [message, onClose]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {message && (
        <p
          role={message.type === "erreur" ? "alert" : "status"}
          className={cn(
            "bg-card pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border p-3 text-sm shadow-lg",
            message.type === "erreur"
              ? "border-destructive/50 text-destructive"
              : "border-success/60",
          )}
        >
          <span className="flex-1">{message.text}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le message"
            className="text-muted-foreground hover:text-foreground -m-1 p-1"
          >
            <X className="size-4" />
          </button>
        </p>
      )}
    </div>
  );
}
