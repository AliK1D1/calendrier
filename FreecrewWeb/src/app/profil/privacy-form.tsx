"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { enregistrerConfidentialite } from "./actions";

/** Option « les autres voient Occupé au lieu du titre de mes blocs » (activée par défaut). */
export function PrivacyForm({ hideTitles }: { hideTitles: boolean }) {
  const [hide, setHide] = useState(hideTitles);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const r = await enregistrerConfidentialite(hide);
          setMessage(
            r.ok ? { ok: true, text: "Réglage enregistré." } : { ok: false, text: r.error },
          );
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={hide}
          onChange={(e) => setHide(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          Masquer le titre de mes blocs : les membres de mes groupes voient seulement « Occupé »,
          l&apos;heure et le lieu.
        </span>
      </label>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-success text-sm" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}
