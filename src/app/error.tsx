"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

/** Erreur inattendue dans une page : message en français et bouton « Réessayer ». */
export default function Erreur({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grille-4 mx-auto max-w-xl content-start gap-y-4 px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">{t.common.error.title}</h1>
      <p className="text-muted-foreground">{t.common.error.body}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>{t.common.error.retry}</Button>
        <Button asChild variant="outline">
          <Link href="/">{t.common.backHome}</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="text-muted-foreground text-xs">{t.common.error.code(error.digest)}</p>
      )}
    </main>
  );
}
