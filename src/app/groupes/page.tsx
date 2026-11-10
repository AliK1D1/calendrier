import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyGroups } from "@/lib/groups/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CreateGroupForm, JoinByCodeForm } from "./group-forms";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.groups.metaTitle };
}
export const dynamic = "force-dynamic";

export default async function MesGroupes() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/groupes");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/groupes");

  const groups = await getMyGroups(supabase, data.user.id);
  const { t } = await getI18n();

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-3xl content-start gap-y-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="titre-page">{t.groups.title}</h1>
          <p className="text-muted-foreground text-sm">
            {t.groups.introBefore}
            <Link href="/profil" className="underline underline-offset-2">
              {t.groups.introLink}
            </Link>
            {t.groups.introAfter}
          </p>
        </header>

        <section aria-labelledby="liste-groupes" className="flex flex-col gap-3">
          <h2 id="liste-groupes" className="titre-section">
            {groups.length === 0 ? t.groups.none : t.groups.count(groups.length)}
          </h2>
          {groups.length > 0 && (
            <ul className="flex flex-col gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/groupes/${g.id}`}
                    className="rangee hover:border-primary/40 flex items-center gap-3 p-3 transition-colors"
                  >
                    <Avatar name={g.name} className="rounded-xl" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold break-words">{g.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {t.groups.members(g.memberCount)}
                      </span>
                    </span>
                    {g.role === "admin" && <Badge variant="secondary">{t.groups.admin}</Badge>}
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>{t.groups.createTitle}</CardTitle>
            <CardDescription>{t.groups.createHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateGroupForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.groups.inviteTitle}</CardTitle>
            <CardDescription>{t.groups.inviteHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <JoinByCodeForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
