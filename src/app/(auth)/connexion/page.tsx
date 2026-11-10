import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/logo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { safeNextPath } from "@/lib/auth/paths";
import { authErrorMessage } from "@/lib/i18n/lookup";
import { getI18n } from "@/lib/i18n/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

import { connexionGoogle, connexionMotDePasse } from "./actions";

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
  const cree = first(params.cree);
  const creeMessage =
    cree === "1" ? t.auth.created : cree === "confirmer" ? t.auth.createdConfirm : undefined;

  if (configured && (await getCurrentUser())) redirect(next);

  return (
    <main className="grille-4 mx-auto min-h-dvh max-w-md content-center gap-y-6 px-4 py-12">
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="font-display flex items-center gap-2.5 font-bold tracking-tight">
          <LogoMark /> {t.common.appName}
        </Link>
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl sm:text-[1.75rem]">{t.auth.title}</CardTitle>
          <CardDescription>{t.auth.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {erreur && (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/8 text-destructive rounded-lg border p-3 text-sm"
            >
              {erreur}
            </p>
          )}
          {creeMessage && (
            <p
              role="status"
              className="border-success/50 bg-success/10 rounded-md border p-3 text-sm"
            >
              {creeMessage}
            </p>
          )}

          <form action={connexionMotDePasse} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="next" value={next} />
            <label htmlFor="pw-email" className="font-medium">
              {t.auth.email}
            </label>
            <Input
              id="pw-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              disabled={!configured}
            />
            <label htmlFor="pw-password" className="font-medium">
              {t.auth.password}
            </label>
            <Input
              id="pw-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={200}
              disabled={!configured}
            />
            <Button type="submit" disabled={!configured}>
              {t.auth.signIn}
            </Button>
          </form>

          <p className="text-muted-foreground text-center text-sm">
            {t.auth.noAccount}{" "}
            <Link
              href={`/inscription?${new URLSearchParams({ next }).toString()}`}
              className="text-foreground font-medium underline"
            >
              {t.auth.createAccount}
            </Link>
          </p>

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
        </CardContent>
      </Card>
    </main>
  );
}
