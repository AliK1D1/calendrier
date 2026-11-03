import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invitePath, normalizeInviteCode } from "@/lib/groups/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { JoinButton } from "./join-button";

export const metadata: Metadata = { title: "Invitation · Temps libre commun" };
export const dynamic = "force-dynamic";

interface Preview {
  group_id: string;
  name: string;
  member_count: number;
  already_member: boolean;
}

/**
 * Page d'un lien d'invitation. Le middleware envoie d'abord vers /connexion (puis ramène ici).
 * On ne rejoint pas à l'ouverture du lien : la personne confirme (sinon un lien piégé
 * pourrait ajouter quelqu'un à un groupe d'inconnus et leur montrer son horaire).
 */
export default async function Rejoindre({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  // Next.js passe le segment encodé ; un « % » isolé ferait échouer decodeURIComponent.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Code mal formé : la validation ci-dessous le refuse.
  }
  const code = normalizeInviteCode(decoded);

  const supabase = await createSupabaseServerClient();
  const next = encodeURIComponent(code.ok ? invitePath(code.value) : "/groupes");
  if (!supabase) redirect(`/connexion?erreur=config&next=${next}`);
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/connexion?next=${next}`);

  let preview: Preview | null = null;
  let dbError = false;
  if (code.ok) {
    const { data: rows, error } = await supabase.rpc("group_invite_preview", {
      code: code.value,
    });
    if (error) {
      console.error("Aperçu d'invitation :", error.code, error.message);
      dbError = true;
    } else {
      preview = ((rows ?? []) as unknown as Preview[])[0] ?? null;
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-xl content-start gap-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Invitation</h1>
        {preview === null ? (
          <Card>
            <CardHeader>
              <CardTitle>Lien d&apos;invitation invalide</CardTitle>
              <CardDescription>
                {dbError
                  ? "Impossible de vérifier ce lien pour l'instant. Réessaie dans une minute."
                  : "Ce lien n'existe pas ou a été remplacé par l'admin du groupe. Demande-lui un nouveau lien."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/groupes">Mes groupes</Link>
              </Button>
            </CardContent>
          </Card>
        ) : preview.already_member ? (
          <Card>
            <CardHeader>
              <CardTitle>Tu fais déjà partie de « {preview.name} »</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/groupes/${preview.group_id}`}>Ouvrir le groupe</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="break-words">Rejoindre « {preview.name} » ?</CardTitle>
              <CardDescription>
                {preview.member_count} membre{preview.member_count > 1 ? "s" : ""}. En rejoignant,
                les membres verront ton nom, tes lieux et quand tu es occupé (par défaut « Occupé »,
                sans le titre de tes cours).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {code.ok && <JoinButton code={code.value} />}
              <Button asChild variant="ghost">
                <Link href="/groupes">Non merci</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
