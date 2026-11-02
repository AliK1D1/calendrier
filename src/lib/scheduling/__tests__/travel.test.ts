import { describe, expect, it } from "vitest";

import {
  DETOUR_FACTOR,
  EstimatedTravelProvider,
  FIXED_OVERHEAD_MINUTES,
  SPEED_KMH,
  estimateTravelMinutes,
  haversineKm,
} from "../travel";
import type { Place, TravelMode } from "../types";
import { PLACES } from "./fixtures";

const MODES: TravelMode[] = ["walk", "bike", "transit", "car"];

describe("haversineKm", () => {
  it("vaut 0 pour un même point", () => {
    expect(haversineKm(PLACES.udem, PLACES.udem)).toBe(0);
  });

  it("1 degré de latitude ≈ 111 km", () => {
    expect(haversineKm({ lat: 45, lng: -73 }, { lat: 46, lng: -73 })).toBeCloseTo(111.19, 1);
  });

  it("Cégep Édouard-Montpetit → UdeM ≈ 10 km à vol d'oiseau", () => {
    const km = haversineKm(PLACES.cegepEM, PLACES.udem);
    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(11);
  });
});

describe("estimateTravelMinutes", () => {
  it.each(MODES)("même lieu = 0 min (%s)", (mode) => {
    expect(estimateTravelMinutes(PLACES.cegepEM, PLACES.cegepEM, mode)).toBe(0);
  });

  it("même endroit sous deux identifiants (coordonnées identiques) = 0 min", () => {
    const copie: Place = { ...PLACES.cegepEM, id: "autre-id" };
    expect(estimateTravelMinutes(PLACES.cegepEM, copie, "transit")).toBe(0);
  });

  it.each(MODES)("symétrique (%s)", (mode) => {
    const pairs: Array<[Place, Place]> = [
      [PLACES.cegepEM, PLACES.downtown],
      [PLACES.udem, PLACES.carrefourLaval],
      [PLACES.aliHome, PLACES.samHome],
    ];
    for (const [a, b] of pairs) {
      expect(estimateTravelMinutes(a, b, mode)).toBe(estimateTravelMinutes(b, a, mode));
    }
  });

  it("arrondit à la minute supérieure et applique la formule", () => {
    const from: Place = { id: "a", name: "A", lat: 45.5, lng: -73.6 };
    const to: Place = { id: "b", name: "B", lat: 45.51, lng: -73.6 };
    const km = haversineKm(from, to) * DETOUR_FACTOR;
    const exact = (km / SPEED_KMH.transit) * 60 + FIXED_OVERHEAD_MINUTES.transit;
    const result = estimateTravelMinutes(from, to, "transit");
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(Math.ceil(exact));
    expect(result).toBeGreaterThanOrEqual(exact);
  });

  it("critère : Cégep de la Rive-Sud → centre-ville en transport en commun ≈ 35 à 60 min", () => {
    const min = estimateTravelMinutes(PLACES.cegepEM, PLACES.downtown, "transit");
    expect(min).toBeGreaterThanOrEqual(35);
    expect(min).toBeLessThanOrEqual(60);
  });

  it("ordres de grandeur plausibles avec les lieux des fixtures", () => {
    // Cégep → UdeM en transport en commun : l'ami « à 40-55 min ».
    const cegepUdem = estimateTravelMinutes(PLACES.cegepEM, PLACES.udem, "transit");
    expect(cegepUdem).toBeGreaterThanOrEqual(40);
    expect(cegepUdem).toBeLessThanOrEqual(60);
    // Maison d'ali → cégep à pied : 15-30 min.
    const aPied = estimateTravelMinutes(PLACES.aliHome, PLACES.cegepEM, "walk");
    expect(aPied).toBeGreaterThanOrEqual(15);
    expect(aPied).toBeLessThanOrEqual(30);
    // Saint-Lambert → cégep à vélo : 10-25 min.
    const velo = estimateTravelMinutes(PLACES.samHome, PLACES.cegepEM, "bike");
    expect(velo).toBeGreaterThanOrEqual(10);
    expect(velo).toBeLessThanOrEqual(25);
    // Maison de Léo → Carrefour Laval en auto : moins de 15 min.
    expect(estimateTravelMinutes(PLACES.leoHome, PLACES.carrefourLaval, "car")).toBeLessThan(15);
    // Laval → Longueuil en auto : 30 à 60 min.
    const lavalLongueuil = estimateTravelMinutes(PLACES.carrefourLaval, PLACES.cegepEM, "car");
    expect(lavalLongueuil).toBeGreaterThanOrEqual(30);
    expect(lavalLongueuil).toBeLessThanOrEqual(60);
  });

  it("plus rapide en auto qu'à vélo, à vélo qu'à pied", () => {
    const [a, b] = [PLACES.cegepEM, PLACES.downtown];
    const walk = estimateTravelMinutes(a, b, "walk");
    const bike = estimateTravelMinutes(a, b, "bike");
    const car = estimateTravelMinutes(a, b, "car");
    expect(car).toBeLessThan(bike);
    expect(bike).toBeLessThan(walk);
  });
});

describe("EstimatedTravelProvider", () => {
  it("renvoie la même valeur que l'estimation pure, 0 pour un même lieu", async () => {
    const provider = new EstimatedTravelProvider();
    expect(await provider.minutes(PLACES.udem, PLACES.udem, "transit")).toBe(0);
    expect(await provider.minutes(PLACES.cegepEM, PLACES.downtown, "transit")).toBe(
      estimateTravelMinutes(PLACES.cegepEM, PLACES.downtown, "transit"),
    );
  });

  it("met en cache chaque paire (from, to, mode)", async () => {
    const provider = new EstimatedTravelProvider();
    const first = await provider.minutes(PLACES.cegepEM, PLACES.udem, "transit");
    expect(provider.cacheSize).toBe(1);
    expect(await provider.minutes(PLACES.cegepEM, PLACES.udem, "transit")).toBe(first);
    expect(provider.cacheSize).toBe(1);
    await provider.minutes(PLACES.cegepEM, PLACES.udem, "car");
    await provider.minutes(PLACES.udem, PLACES.cegepEM, "transit");
    expect(provider.cacheSize).toBe(3);
    provider.clearCache();
    expect(provider.cacheSize).toBe(0);
  });

  it("un lieu déplacé (mêmes id, nouvelles coordonnées) est recalculé", async () => {
    const provider = new EstimatedTravelProvider();
    const before = await provider.minutes(PLACES.cegepEM, PLACES.udem, "transit");
    const moved: Place = { ...PLACES.udem, lat: PLACES.cegepEM.lat + 0.001 };
    const after = await provider.minutes(PLACES.cegepEM, moved, "transit");
    expect(after).toBeLessThan(before);
  });
});
