import { describe, expect, it } from "vitest";

import {
  PLACE_NAME_MAX,
  toFiniteNumber,
  validateCoordinates,
  validateDisplayName,
  validateOnboardingInput,
  validatePlaceId,
  validatePlaceInput,
  validatePlaceName,
  validateTravelMode,
} from "../validation";

const cegep = { name: "Cégep Édouard-Montpetit", lat: 45.5355093, lng: -73.4955201 };

describe("validatePlaceName", () => {
  it("nettoie les espaces", () => {
    expect(validatePlaceName("  Ma   maison ")).toEqual({ ok: true, value: "Ma maison" });
  });

  it("refuse vide, trop long, non textuel, caractères de contrôle", () => {
    expect(validatePlaceName("   ").ok).toBe(false);
    expect(validatePlaceName("x".repeat(PLACE_NAME_MAX + 1)).ok).toBe(false);
    expect(validatePlaceName("x".repeat(PLACE_NAME_MAX)).ok).toBe(true);
    expect(validatePlaceName(null).ok).toBe(false);
    expect(validatePlaceName("a\u0007b").ok).toBe(false);
  });
});

describe("coordonnées", () => {
  it("lit nombres et chaînes (virgule décimale comprise)", () => {
    expect(toFiniteNumber("45,5355")).toBe(45.5355);
    expect(toFiniteNumber(" -73.4955 ")).toBe(-73.4955);
    expect(toFiniteNumber("1e3")).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
  });

  it("arrondit à 6 décimales et refuse hors limites", () => {
    expect(validateCoordinates(45.5355093, -73.4955201)).toEqual({
      ok: true,
      value: { lat: 45.535509, lng: -73.49552 },
    });
    expect(validateCoordinates(91, 0).ok).toBe(false);
    expect(validateCoordinates(0, -181).ok).toBe(false);
    expect(validateCoordinates(undefined, 0).ok).toBe(false);
  });
});

describe("validatePlaceInput", () => {
  it("accepte un lieu complet", () => {
    expect(validatePlaceInput(cegep)).toEqual({
      ok: true,
      value: { name: "Cégep Édouard-Montpetit", lat: 45.535509, lng: -73.49552 },
    });
  });

  it("refuse un objet absent ou incomplet", () => {
    expect(validatePlaceInput(null).ok).toBe(false);
    expect(validatePlaceInput({ name: "x" }).ok).toBe(false);
    expect(validatePlaceInput({ lat: 1, lng: 1 }).ok).toBe(false);
  });
});

describe("profil", () => {
  it("mode de transport : seulement les 4 valeurs connues", () => {
    for (const m of ["walk", "bike", "transit", "car"]) expect(validateTravelMode(m).ok).toBe(true);
    expect(validateTravelMode("avion").ok).toBe(false);
    expect(validateTravelMode(undefined).ok).toBe(false);
  });

  it("nom affiché", () => {
    expect(validateDisplayName(" Ali ")).toEqual({ ok: true, value: "Ali" });
    expect(validateDisplayName("").ok).toBe(false);
  });

  it("identifiant de lieu : uuid seulement", () => {
    expect(validatePlaceId("00000000-0000-4000-8000-00000000000A")).toEqual({
      ok: true,
      value: "00000000-0000-4000-8000-00000000000a",
    });
    expect(validatePlaceId("1; drop table places").ok).toBe(false);
  });
});

describe("validateOnboardingInput", () => {
  const maison = { name: "Maison", lat: 45.52, lng: -73.48 };

  it("maison + cégep + mode", () => {
    const r = validateOnboardingInput({ home: maison, school: cegep, travelMode: "bike" });
    expect(r.ok && r.value.school?.name).toBe("Cégep Édouard-Montpetit");
    expect(r.ok && r.value.travelMode).toBe("bike");
  });

  it("le cégep est facultatif", () => {
    const r = validateOnboardingInput({ home: maison, school: null, travelMode: "transit" });
    expect(r).toMatchObject({ ok: true, value: { school: null } });
  });

  it("la maison est obligatoire et les erreurs disent quel lieu est en cause", () => {
    expect(validateOnboardingInput({ travelMode: "walk" })).toEqual({
      ok: false,
      error: "Choisis l'adresse de ta maison.",
    });
    const r = validateOnboardingInput({
      home: maison,
      school: { name: "", lat: 0, lng: 0 },
      travelMode: "walk",
    });
    expect(r.ok === false && r.error).toMatch(/^Cégep ou école/);
    expect(validateOnboardingInput({ home: maison, travelMode: "fusée" }).ok).toBe(false);
  });
});
