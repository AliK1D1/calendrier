"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MAX, passwordProblems, USERNAME_MAX } from "@/lib/auth/signup";
import { useI18n } from "@/lib/i18n/client";
import { signupErrorMessage } from "@/lib/i18n/lookup";

import { creerCompte, type SignupState } from "./actions";

const INITIAL: SignupState = { error: null, email: "", username: "" };

/** Formulaire de création de compte : courriel, nom d'utilisateur, mot de passe deux fois. */
export function SignupForm({ next, configured }: { next: string; configured: boolean }) {
  const { t } = useI18n();
  const s = t.auth.signup;
  const [state, action, pending] = useActionState(creerCompte, INITIAL);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const erreur = signupErrorMessage(t, configured ? (state.error ?? undefined) : "config");

  const problems = passwordProblems(password);
  const rules = [
    { key: "court", ok: !problems.includes("court") },
    { key: "majuscule", ok: !problems.includes("majuscule") },
    { key: "minuscule", ok: !problems.includes("minuscule") },
    { key: "chiffre", ok: !problems.includes("chiffre") },
    { key: "pareil", ok: password.length > 0 && password === confirm },
  ] as const;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {erreur && (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
        >
          {erreur}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="su-email">{t.auth.email}</Label>
        <Input
          id="su-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={t.auth.emailPlaceholder}
          defaultValue={state.email}
          disabled={!configured}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="su-username">{s.username}</Label>
        <Input
          id="su-username"
          name="username"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={3}
          maxLength={USERNAME_MAX}
          defaultValue={state.username}
          aria-describedby="su-username-hint"
          disabled={!configured}
        />
        <p id="su-username-hint" className="text-muted-foreground text-xs">
          {s.usernameHint}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="su-password">{s.password}</Label>
        <Input
          id="su-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="su-password-rules"
          disabled={!configured}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="su-confirm">{s.confirm}</Label>
        <Input
          id="su-confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={!configured}
        />
      </div>

      <ul id="su-password-rules" className="flex flex-col gap-1 text-sm" aria-live="polite">
        {rules.map((r) => (
          <li key={r.key} className={r.ok ? "text-success" : "text-muted-foreground"}>
            <span aria-hidden="true">{r.ok ? "✓" : "○"}</span> {s.rules[r.key]}
          </li>
        ))}
      </ul>

      <Button type="submit" disabled={!configured || pending}>
        {s.submit}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        {s.haveAccount}{" "}
        <Link
          href={`/connexion?${new URLSearchParams({ next }).toString()}`}
          className="text-foreground font-medium underline"
        >
          {s.signIn}
        </Link>
      </p>
    </form>
  );
}
