"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Point mis en évidence (ex. le résultat choisi). */
  highlighted?: boolean;
}

export interface PlaceMapProps {
  points: MapPoint[];
  /** Appelé quand on touche la carte (pour ajuster le point). */
  onPick?: (lat: number, lng: number) => void;
  className?: string;
}

/** Centre par défaut : Montréal. */
const DEFAULT_CENTER: L.LatLngExpression = [45.5017, -73.5673];

/**
 * Petite carte Leaflet + tuiles OpenStreetMap. Chargée seulement dans le navigateur (voir
 * place-map-lazy.tsx) : Leaflet touche `window` dès l'import.
 */
export default function PlaceMap({ points, onPick, className }: PlaceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: DEFAULT_CENTER, zoom: 11 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">les contributeurs d’OpenStreetMap</a>',
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const p of points) {
      L.circleMarker([p.lat, p.lng], {
        radius: p.highlighted ? 10 : 7,
        color: p.highlighted ? "#b91c1c" : "#1d4ed8",
        weight: 3,
        fillOpacity: 0.6,
      })
        .bindTooltip(p.label)
        .addTo(layer);
    }
    const focus = points.find((p) => p.highlighted);
    if (focus) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 16));
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        padding: [24, 24],
        maxZoom: 15,
      });
    }
  }, [points]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Carte"
      className={cn("z-0 h-64 w-full overflow-hidden rounded-lg border", className)}
    />
  );
}
