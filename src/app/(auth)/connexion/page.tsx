import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LOGIN_ERRORS, safeNextPath } from "@/lib/auth/paths";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

import { connexionGoogle, connexionMotDePasse, envoyerLienMagique } from "./actions";

export const metadata: Metadata = { title: "Connexion · Temps libre commun" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Connexion({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const configured = isSupabaseConfigured();
  const erreurCode = configured ? first(params.erreur) : "config";
  const erreur = erreurCode ? LOGIN_ERRORS[erreurCode] : undefined;
  const envoye = first(params.envoye) === "1";

  if (configured && (await getCurrentUser())) redirect(next);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-muted-foreground text-sm hover:underline">
        ← Temps libre commun
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Connexion</CardTitle>
          <CardDescription>
            Le plus simple : on t&apos;envoie un lien de connexion par courriel. Pas encore de
            compte ? Il est créé automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {erreur && (
            <p
              role="alert"
              className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
            >
              {erreur}
            </p>
          )}
          {envoye && (
            <p
              role="status"
              className="border-success/50 bg-success/10 rounded-md border p-3 text-sm"
            >
              Lien envoyé ! Ouvre le courriel <strong>dans ce même navigateur</strong> pour te
              connecter. Pense à regarder dans les indésirables.
            </p>
          )}

          <form action={envoyerLienMagique} className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <label htmlFor="email" className="text-sm font-medium">
              Adresse courriel
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="toi@exemple.ca"
              disabled={!configured}
              className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-base outline-none focus-visible:ring-2"
            />
            <Button type="submit" disabled={!configured}>
              Recevoir un lien de connexion
            </Button>
          </form>

          <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
            <span className="bg-border h-px flex-1" />
            ou
            <span className="bg-border h-px flex-1" />
          </div>

          <form action={connexionGoogle}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="outline" className="w-full" disabled={!configured}>
              Continuer avec Google
            </Button>
          </form>

          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              Se connecter avec un mot de passe
            </summary>
            <form action={connexionMotDePasse} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="pw-email" className="font-medium">
                Adresse courriel
              </label>
              <input
                id="pw-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                disabled={!configured}
                className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-base outline-none focus-visible:ring-2"
              />
              <label htmlFor="pw-password" className="font-medium">
                Mot de passe
              </label>
              <input
                id="pw-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={200}
                disabled={!configured}
                className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-base outline-none focus-visible:ring-2"
              />
              <Button type="submit" variant="outline" disabled={!configured}>
                Se connecter
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>
    </main>
  );
}
