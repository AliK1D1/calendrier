import Link from "next/link";
import { Suspense } from "react";

import { LogoMark } from "./logo-mark";
import { BottomTabs, NavLinks } from "./nav-links";
import { PlansBadge } from "./plans-badge";

/**
 * En-tête des pages connectées. Ordinateur : logo et les six liens en haut. Téléphone : logo,
 * nom de l'app, Lieux et Profil en haut ; Groupes, Plans, Horaire et Étude dans la barre
 * d'onglets du bas (4 colonnes), à portée du pouce.
 */
export function SiteHeader() {
  const badge = (
    <Suspense fallback={null}>
      <PlansBadge />
    </Suspense>
  );
  return (
    <>
      <header className="bg-card/90 sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)] backdrop-blur">
        <nav
          aria-label="Navigation principale"
          className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 text-sm sm:gap-4"
        >
          <Link
            href="/"
            className="-ml-1 flex h-11 min-w-0 items-center gap-2 px-1 font-semibold tracking-tight"
            aria-label="Accueil"
          >
            <LogoMark />
            <span className="truncate max-[359px]:sr-only">Temps libre commun</span>
          </Link>
          <span className="flex-1" />
          <NavLinks plansBadge={badge} />
        </nav>
      </header>
      <BottomTabs plansBadge={badge} />
    </>
  );
}
