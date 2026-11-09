import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { safeNextPath } from "@/lib/auth/paths";
import { getI18n } from "@/lib/i18n/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signup.metaTitle };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Inscription({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { t } = await getI18n();
  const next = safeNextPath(first(params.next));
  const configured = isSupabaseConfigured();

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
          <CardTitle className="text-2xl">{t.auth.signup.title}</CardTitle>
          <CardDescription>{t.auth.signup.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm next={next} configured={configured} />
        </CardContent>
      </Card>
    </main>
  );
}
