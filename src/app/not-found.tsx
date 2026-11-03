import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

/** Page introuvable (remplace la page anglaise par défaut de Next.js). */
export default function PageIntrouvable() {
  return (
    <>
      <SiteHeader />
      <main className="grille-4 mx-auto max-w-xl content-start gap-y-4 px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight">Page introuvable</h1>
        <p className="text-muted-foreground">
          Cette page n&apos;existe pas, ou tu n&apos;y as pas accès (par exemple un groupe dont tu
          ne fais pas partie).
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Retour à l&apos;accueil</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/groupes">Mes groupes</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
