"use client";

import { TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { splitQuestion } from "@/lib/ux/confirm";

export interface ConfirmOptions {
  /**
   * La question, suivie au besoin de ce qui va se passer : « Supprimer « Café » ? C'est ta
   * maison… ». La question devient le titre, la suite le texte (voir `splitQuestion`).
   */
  message: string;
  /** Le mot du bouton qui confirme : le même que celui du bouton d'origine (« Supprimer »). */
  action: string;
  /** Action qu'on ne peut pas défaire : bouton rouge. Vrai par défaut. */
  danger?: boolean;
}

/**
 * Fenêtre de confirmation de l'app, à la place de `window.confirm` du navigateur (qui est en
 * anglais sur certains téléphones, sans style, et dont les boutons disent « OK »). Le bouton
 * qui confirme reprend le verbe de l'action ; « Annuler » a le focus à l'ouverture, pour
 * qu'Entrée ne supprime rien par accident.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * if (await confirm({ message: "Supprimer « Café » ?", action: "Supprimer" })) { … }
 * return <>{…}{confirmDialog}</>;
 * ```
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const confirm = useCallback((o: ConfirmOptions) => {
    // Une question encore ouverte est refusée avant d'en poser une autre.
    resolver.current?.(false);
    setOptions(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options && !el.open) el.showModal();
    if (!options && el.open) el.close();
  }, [options]);

  // Composant démonté avec la question ouverte : on répond « non ».
  useEffect(() => () => resolver.current?.(false), []);

  const danger = options?.danger ?? true;
  const question = options ? splitQuestion(options.message) : null;
  const confirmDialog = (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={question?.body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        answer(false);
      }}
      // React fait remonter « close » aux parents : sans ceci, fermer cette fenêtre fermerait
      // aussi la fenêtre qui la contient (ex. « Modifier le bloc »).
      onClose={(e) => e.stopPropagation()}
      onClick={(e) => {
        // Clic à côté de la fenêtre (sur le fond).
        if (e.target === e.currentTarget) answer(false);
      }}
      className="bg-popover text-popover-foreground shadow-flottant m-0 mt-auto w-full max-w-none rounded-t-2xl border p-0 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      {options && question && (
        <div className="flex flex-col gap-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
          <div className="flex items-start gap-3">
            {danger && (
              <span
                aria-hidden
                className="bg-destructive/12 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <TriangleAlert className="size-5" />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id={titleId} className="titre-section break-words">
                {question.title}
              </h2>
              {question.body && (
                <p id={bodyId} className="text-muted-foreground text-sm whitespace-pre-line">
                  {question.body}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" autoFocus onClick={() => answer(false)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant={danger ? "destructive" : "default"}
              onClick={() => answer(true)}
            >
              {options.action}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { confirm, confirmDialog };
}
