import { SiteHeader } from "@/components/site-header";

/**
 * Affiché pendant le chargement d'une page (les pages lisent la BD à chaque visite) :
 * sans lui, un clic dans le menu semble ne rien faire pendant une ou deux secondes.
 */
export default function Chargement() {
  return (
    <>
      <SiteHeader />
      <div
        role="status"
        aria-live="polite"
        className="grille-4 mx-auto max-w-3xl content-start gap-y-4 px-4 py-6"
      >
        <span className="sr-only">Chargement…</span>
        <div className="bg-muted h-8 w-1/2 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-3/4 animate-pulse rounded-md" />
        <div className="bg-muted h-40 w-full animate-pulse rounded-lg" />
        <div className="bg-muted h-24 w-full animate-pulse rounded-lg" />
      </div>
    </>
  );
}
