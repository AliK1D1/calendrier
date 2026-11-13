import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

/** Page introuvable (remplace la page anglaise par défaut de Next.js). */
export default async function PageIntrouvable() {
  const { t } = await getI18n();
  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-xl content-start gap-y-4 px-4 py-12">
        <h1 className="titre-page">{t.common.notFound.title}</h1>
        <p className="text-muted-foreground">{t.common.notFound.body}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">{t.common.backHome}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/groupes">{t.common.myGroups}</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
