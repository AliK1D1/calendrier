"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LIENS = [
  { href: "/groupes", label: "Groupes" },
  { href: "/plans", label: "Plans" },
  { href: "/horaire", label: "Horaire" },
  { href: "/etude", label: "Étude" },
  { href: "/lieux", label: "Lieux" },
  { href: "/profil", label: "Profil" },
];

/** Liens du menu ; la page où l'on est est mise en évidence (et annoncée au lecteur d'écran). */
export function NavLinks({ plansBadge }: { plansBadge?: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      {LIENS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hover:text-foreground flex h-full items-center border-b-2 border-transparent",
              active ? "border-primary text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {l.label}
            {l.href === "/plans" && plansBadge}
          </Link>
        );
      })}
    </>
  );
}
