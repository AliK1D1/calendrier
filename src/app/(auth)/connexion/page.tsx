import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { safeNextPath } from "@/lib/auth/paths";
import { authErrorMessage } from "@/lib/i18n/lookup";
import { getI18n } from "@/lib/i18n/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

import { connexionGoogle, connexionMotDePasse, envoyerLienMagique } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.metaTitle };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Connexion({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { t } = await getI18n();
  const next = safeNextPath(first(params.next));
  const configured = isSupabaseConfigured();
  const erreurCode = configured ? first(params.erreur) : "config";
  const erreur = authErrorMessage(t, erreurCode);
  const envoye = first(params.envoye) === "1";

  if (configured && (await getCurrentUser())) redirect(next);

  return (
    <main className="grille-4 mx-auto min-h-dvh max-w-md content-center gap-y-6 px-4 py-12">
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="text-muted-foreground text-sm hover:underline">
          ← {t.common.appName}
        </Link>
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t.auth.title}</CardTitle>
          <CardDescription>{t.auth.description}</CardDescription>
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
              {t.auth.sentBefore}
              <strong>{t.auth.sentStrong}</strong>
              {t.auth.sentAfter}
            </p>
          )}

          <form action={envoyerLienMagique} className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <label htmlFor="email" className="text-sm font-medium">
              {t.auth.email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder={t.auth.emailPlaceholder}
              disabled={!configured}
              className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-base outline-none focus-visible:ring-2"
            />
            <Button type="submit" disabled={!configured}>
              {t.auth.sendLink}
            </Button>
          </form>

          <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
            <span className="bg-border h-px flex-1" />
            {t.auth.or}
            <span className="bg-border h-px flex-1" />
          </div>

          <form action={connexionGoogle}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="outline" className="w-full" disabled={!configured}>
              {t.auth.google}
            </Button>
          </form>

          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              {t.auth.withPassword}
            </summary>
            <form action={connexionMotDePasse} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="pw-email" className="font-medium">
                {t.auth.email}
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
                {t.auth.password}
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
                {t.auth.signIn}
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>
    </main>
  );
}
