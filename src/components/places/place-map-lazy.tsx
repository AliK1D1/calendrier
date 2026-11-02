"use client";

import dynamic from "next/dynamic";

/** Carte chargée seulement côté navigateur (Leaflet ne fonctionne pas au rendu serveur). */
export const PlaceMapLazy = dynamic(() => import("./place-map"), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground flex h-64 w-full items-center justify-center rounded-lg border text-sm">
      Chargement de la carte…
    </div>
  ),
});

export type { MapPoint } from "./place-map";
