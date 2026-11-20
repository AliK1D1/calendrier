"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * Bouton d'envoi d'un formulaire à action serveur : une roue tourne et le bouton
 * se désactive pendant l'envoi (évite les doubles clics).
 */
export function SubmitButton({
  children,
  disabled,
  pending: pendingProp,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
