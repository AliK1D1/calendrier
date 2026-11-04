"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Entre deux appels du même onglet (la BD limite déjà à une synchro par 15 min). */
const MIN_GAP_MS = 5 * 60_000;
/** Pendant que l'app reste ouverte : un essai aux 15 min. */
const INTERVAL_MS = 15 * 60_000;
const KEY = "outlook-sync-at";

function lastCall(): number {
  try {
    return Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

function remember(at: number) {
  try {
    sessionStorage.setItem(KEY, String(at));
  } catch {
    // Stockage bloqué : on appelle quand même (le serveur limite).
  }
}

/**
 * Synchronisation Outlook en arrière-plan quand l'app est ouverte : au chargement d'une page
 * (au plus aux 5 min par onglet), puis aux 15 min. Si de nouvelles données arrivent, la page
 * est rechargée. Ne fait rien de visible ; sans Outlook connecté, le serveur répond « rien ».
 */
export function OutlookAutoSync() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const tick = async (force: boolean) => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (!force && now - lastCall() < MIN_GAP_MS) return;
      remember(now);
      try {
        const res = await fetch("/api/outlook/sync", { method: "POST", cache: "no-store" });
        if (!res.ok || stopped) return;
        const body: unknown = await res.json();
        if (
          typeof body === "object" &&
          body !== null &&
          (body as { changed?: unknown }).changed === true
        ) {
          router.refresh();
        }
      } catch {
        // Hors ligne : on réessaiera au prochain tour.
      }
    };
    void tick(false);
    const id = window.setInterval(() => void tick(true), INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [router]);
  return null;
}
