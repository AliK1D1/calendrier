"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Sommaire « Sur cette page » : une rangée de liens vers les sections d'une longue page
 * (Groupe, Profil). Elle reste collée sous l'en-tête quand on descend, et la section qu'on
 * est en train de lire est mise en évidence : on sait où l'on est et on change de section
 * sans remonter. Au téléphone, la rangée défile de côté au lieu de passer à la ligne.
 */
export function PageSections({ items }: { items: { id: string; label: string }[] }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const ids = items.map((i) => i.id).join(" ");

  useEffect(() => {
    const targets = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // La première section visible, dans l'ordre de la page.
        const first = targets.find((el) => visible.has(el.id));
        if (first) setCurrent(first.id);
      },
      // Bande de lecture : sous l'en-tête et le sommaire, jusqu'au milieu de l'écran.
      { rootMargin: "-120px 0px -50% 0px" },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  // Au téléphone, la pastille de la section courante reste visible dans la rangée.
  useEffect(() => {
    if (!current) return;
    const row = list.current?.parentElement;
    const chip = list.current?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!row || !chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16;
    if (left < row.scrollLeft) row.scrollTo({ left, behavior: "smooth" });
    else if (right > row.scrollLeft + row.clientWidth)
      row.scrollTo({ left: right - row.clientWidth, behavior: "smooth" });
  }, [current]);

  return (
    <nav
      aria-label={t.common.nav.onThisPage}
      className="bg-background/90 sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-[5] -mx-4 [scrollbar-width:none] overflow-x-auto px-4 py-2 backdrop-blur-md"
    >
      <ul ref={list} className="relative flex w-max gap-1.5 text-sm">
        {items.map((i) => {
          const active = i.id === current;
          return (
            <li key={i.id}>
              <Link
                href={`#${i.id}`}
                data-section={i.id}
                aria-current={active ? "location" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 flex h-9 items-center rounded-full px-3.5 font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
                  active
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
