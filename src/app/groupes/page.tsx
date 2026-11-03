import { ChevronRight, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyGroups } from "@/lib/groups/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { plural } from "@/lib/ux/plural";

import { CreateGroupForm, JoinByCodeForm } from "./group-forms";

export const metadata: Metadata = { title: "Mes groupes · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function MesGroupes() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/groupes");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/groupes");

  const groups = await getMyGroups(supabase, data.user.id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Mes groupes</h1>
          <p className="text-muted-foreground text-sm">
            Crée un groupe et envoie le lien d&apos;invitation à tes amis. Les membres d&apos;un
            groupe voient quand tu es occupé et où, mais pas le titre de tes cours (réglable dans
            ton{" "}
            <Link href="/profil" className="underline underline-offset-2">
              profil
            </Link>
            ).
          </p>
        </header>

        <section aria-labelledby="liste-groupes" className="flex flex-col gap-3">
          <h2 id="liste-groupes" className="text-lg font-semibold">
            {groups.length === 0 ? "Aucun groupe pour l'instant" : plural(groups.length, "groupe")}
          </h2>
          {groups.length > 0 && (
            <ul className="flex flex-col gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/groupes/${g.id}`}
                    className="bg-card hover:bg-accent flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Users className="text-muted-foreground size-5 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium break-words">{g.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {g.memberCount} membre{g.memberCount > 1 ? "s" : ""}
                      </span>
                    </span>
                    {g.role === "admin" && <Badge variant="secondary">Admin</Badge>}
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Créer un groupe</CardTitle>
            <CardDescription>
              Tu en seras l&apos;admin : tu pourras retirer un membre ou changer le lien
              d&apos;invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateGroupForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>J&apos;ai reçu une invitation</CardTitle>
            <CardDescription>
              Ouvre le lien reçu, ou colle-le ici (ou seulement le code).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JoinByCodeForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
