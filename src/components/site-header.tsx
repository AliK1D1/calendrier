import Link from "next/link";
import { Suspense } from "react";

import { LogoMark } from "./logo-mark";
import { NavLinks } from "./nav-links";
import { PlansBadge } from "./plans-badge";

/** En-tête des pages connectées : retour à l'accueil et liens principaux. */
export function SiteHeader() {
  return (
    <header className="bg-card/90 sticky top-0 z-10 border-b backdrop-blur">
      <nav
        aria-label="Navigation principale"
        className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 text-[0.8125rem] min-[400px]:gap-3 min-[400px]:text-sm sm:gap-4"
      >
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
          aria-label="Accueil"
        >
          <LogoMark />
          <span className="hidden sm:inline">Temps libre commun</span>
        </Link>
        <span className="flex-1" />
        <NavLinks
          plansBadge={
            <Suspense fallback={null}>
              <PlansBadge />
            </Suspense>
          }
        />
      </nav>
    </header>
  );
}
