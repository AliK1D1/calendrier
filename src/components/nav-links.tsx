"use client";

import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CircleUser,
  type LucideIcon,
  MapPin,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface Lien {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Les 4 onglets du bas au téléphone (une colonne chacun de la grille à 4 colonnes). */
const PRINCIPAUX: Lien[] = [
  { href: "/groupes", label: "Groupes", icon: Users },
  { href: "/plans", label: "Plans", icon: CalendarCheck },
  { href: "/horaire", label: "Horaire", icon: CalendarDays },
  { href: "/etude", label: "Étude", icon: BookOpen },
];

/** Réglages, en haut à droite au téléphone. */
const SECONDAIRES: Lien[] = [
  { href: "/lieux", label: "Lieux", icon: MapPin },
  { href: "/profil", label: "Profil", icon: CircleUser },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Liens du menu en haut. Ordinateur : les six liens en texte. Téléphone : seulement Lieux et
 * Profil (icône + mot), les autres sont dans la barre du bas. La page où l'on est est mise en
 * évidence (et annoncée au lecteur d'écran).
 */
export function NavLinks({ plansBadge }: { plansBadge?: ReactNode }) {
  const isActive = useActive();
  return (
    <>
      {[...PRINCIPAUX, ...SECONDAIRES].map((l) => {
        const active = isActive(l.href);
        const secondaire = SECONDAIRES.includes(l);
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hover:text-foreground h-full items-center border-b-2 border-transparent",
              // Téléphone : seulement les liens secondaires, avec une zone de 44 px de large.
              secondaire
                ? "flex gap-1.5 max-sm:min-w-11 max-sm:justify-center max-sm:px-1"
                : "hidden sm:flex",
              active ? "border-primary text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5 sm:hidden" aria-hidden />
            {l.label}
            {l.href === "/plans" && plansBadge}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Barre d'onglets fixée en bas de l'écran au téléphone (cachée à partir de 640 px) : quatre
 * colonnes égales, cibles de 60 px de haut, icône + mot. Laisse la place du geste d'accueil
 * de l'iPhone (`safe-area-inset-bottom`).
 */
export function BottomTabs({ plansBadge }: { plansBadge?: ReactNode }) {
  const isActive = useActive();
  return (
    <nav
      aria-label="Onglets"
      data-barre-onglets
      className="bg-card/95 fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grille-4-quart mx-auto h-(--barre-onglets) max-w-md px-2">
        {PRINCIPAUX.map((l) => {
          const active = isActive(l.href);
          const Icon = l.icon;
          return (
            <li key={l.href} className="flex">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs",
                  active ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary/12",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {l.href === "/plans" && plansBadge && (
                    <span className="absolute -top-1 left-1/2 ml-1">{plansBadge}</span>
                  )}
                </span>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
