"use client";

import dynamic from "next/dynamic";

import { useI18n } from "@/lib/i18n/client";

function MapLoading() {
  const { t } = useI18n();
  return (
    <div className="bg-muted text-muted-foreground flex h-64 w-full items-center justify-center rounded-lg border text-sm">
      {t.places.mapLoading}
    </div>
  );
}

/** Carte chargée seulement côté navigateur (Leaflet ne fonctionne pas au rendu serveur). */
export const PlaceMapLazy = dynamic(() => import("./place-map"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export type { MapPoint } from "./place-map";
