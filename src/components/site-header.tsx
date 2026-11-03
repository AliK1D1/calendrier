import { House } from "lucide-react";
import Link from "next/link";

import { NavLinks } from "./nav-links";

/** En-tête des pages connectées : retour à l'accueil et liens principaux. */
export function SiteHeader() {
  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      <nav
        aria-label="Navigation principale"
        className="mx-auto flex h-12 max-w-3xl items-center gap-3 px-4 text-sm sm:gap-4"
      >
        <Link href="/" className="font-semibold" aria-label="Accueil">
          <House className="size-5 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">Temps libre commun</span>
        </Link>
        <span className="flex-1" />
        <NavLinks />
      </nav>
    </header>
  );
}
