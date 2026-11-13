import Link from "next/link";
import { Suspense } from "react";

import { getI18n } from "@/lib/i18n/server";

import { LanguageSwitcher } from "./language-switcher";
import { LogoMark } from "./logo-mark";
import { BottomTabs, NavLinks } from "./nav-links";
import { OutlookAutoSync } from "./outlook-auto-sync";
import { PlansBadge } from "./plans-badge";

/**
 * En-tête des pages connectées. Ordinateur : logo et les six liens en haut. Téléphone : logo,
 * nom de l'app, Lieux et Profil en haut ; Groupes, Plans, Horaire et Étude dans la barre
 * d'onglets du bas (4 colonnes), à portée du pouce.
 */
export async function SiteHeader() {
  const { t } = await getI18n();
  const badge = (
    <Suspense fallback={null}>
      <PlansBadge />
    </Suspense>
  );
  return (
    <>
      <header className="bg-background/85 sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <nav
          aria-label={t.common.nav.main}
          className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 text-sm sm:gap-1"
        >
          <Link
            href="/"
            className="font-display -ml-1 flex h-11 min-w-0 items-center gap-2.5 px-1 text-base font-bold tracking-tight"
            aria-label={t.common.nav.home}
          >
            <LogoMark />
            {/* Téléphone : le nom court, pour laisser la place à Lieux et Profil. */}
            <span className="truncate max-sm:hidden">{t.common.appName}</span>
            <span aria-hidden className="truncate max-[359px]:hidden sm:hidden">
              {t.common.appShortName}
            </span>
          </Link>
          <span className="flex-1" />
          <NavLinks plansBadge={badge} />
          <LanguageSwitcher />
        </nav>
      </header>
      <BottomTabs plansBadge={badge} />
      <OutlookAutoSync />
    </>
  );
}
