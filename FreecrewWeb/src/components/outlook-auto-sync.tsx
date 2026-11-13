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

/** Appelle une route de synchro ; vrai si de nouvelles données sont arrivées. */
async function pull(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "POST", cache: "no-store" });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" && body !== null && (body as { changed?: unknown }).changed === true
    );
  } catch {
    // Hors ligne : on réessaiera au prochain tour.
    return false;
  }
}

/**
 * Synchronisation Outlook et calendriers abonnés (story 3) en arrière-plan quand l'app est
 * ouverte : au chargement d'une page (au plus aux 5 min par onglet), puis aux 15 min. Le
 * serveur décide de ce qui est dû (Outlook : 15 min ; calendriers abonnés : 6 h). Si de
 * nouvelles données arrivent, la page est rechargée. Ne fait rien de visible.
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
      const changed = await Promise.all([pull("/api/outlook/sync"), pull("/api/abonnements/sync")]);
      if (!stopped && changed.some(Boolean)) router.refresh();
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
