"use client";

import { useState, useTransition } from "react";

import { TravelModePicker } from "@/components/travel-mode-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPLAY_NAME_MAX } from "@/lib/places/validation";
import type { TravelMode } from "@/lib/scheduling/types";

import { enregistrerProfil } from "./actions";

export function ProfileForm({
  displayName,
  travelMode,
}: {
  displayName: string;
  travelMode: TravelMode;
}) {
  const [name, setName] = useState(displayName);
  const [mode, setMode] = useState<TravelMode>(travelMode);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const r = await enregistrerProfil({ displayName: name, travelMode: mode });
          setMessage(
            r.ok ? { ok: true, text: "Profil enregistré." } : { ok: false, text: r.error },
          );
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="display-name">Ton nom (vu par tes amis)</Label>
        <Input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          required
        />
      </div>
      <TravelModePicker value={mode} onChange={setMode} />
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
