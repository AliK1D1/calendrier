"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Erreur inattendue dans une page : message en français et bouton « Réessayer ». */
export default function Erreur({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grille-4 mx-auto max-w-xl content-start gap-y-4 px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Oups, quelque chose a planté</h1>
      <p className="text-muted-foreground">
        Rien n&apos;a été perdu. Réessaie ; si ça recommence, attends une minute (la connexion ou le
        serveur est peut-être lent).
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Réessayer</Button>
        <Button asChild variant="outline">
          <Link href="/">Retour à l&apos;accueil</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="text-muted-foreground text-xs">Code de l&apos;erreur : {error.digest}</p>
      )}
    </main>
  );
}
