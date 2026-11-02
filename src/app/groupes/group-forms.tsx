"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GROUP_NAME_MAX, invitePath, normalizeInviteCode } from "@/lib/groups/validation";

import { creerGroupe } from "./actions";

/** Création d'un groupe, puis ouverture de sa page (pour copier le lien d'invitation). */
export function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await creerGroupe(name);
          if (r.ok) router.push(`/groupes/${r.id}`);
          else setError(r.error);
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="nom-groupe">Nom du groupe</Label>
        <Input
          id="nom-groupe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={GROUP_NAME_MAX}
          placeholder="ex. La gang du cégep"
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? "Création…" : "Créer le groupe"}
      </Button>
    </form>
  );
}

/** Coller un lien ou un code d'invitation : ouvre la page /rejoindre/[code] (confirmation). */
export function JoinByCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeInviteCode(value);
        if (!code.ok) {
          setError(code.error);
          return;
        }
        setError(null);
        router.push(invitePath(code.value));
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="code-invitation">Lien ou code d&apos;invitation</Label>
        <Input
          id="code-invitation"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" className="sm:self-start">
        Continuer
      </Button>
    </form>
  );
}
