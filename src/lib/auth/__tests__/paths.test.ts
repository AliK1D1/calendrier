import { describe, expect, it } from "vitest";

import { isPlausibleEmail, isPublicPath, safeNextPath } from "../paths";

describe("isPublicPath", () => {
  it("laisse passer l'accueil, /connexion et /auth/*", () => {
    for (const p of ["/", "/connexion", "/auth/callback", "/auth/deconnexion"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("protège tout le reste", () => {
    for (const p of ["/horaire", "/lieux", "/groupes/123", "/etude", "/connexions", "/authx"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("safeNextPath", () => {
  it("garde un chemin interne avec sa requête", () => {
    expect(safeNextPath("/horaire")).toBe("/horaire");
    expect(safeNextPath("/groupes/abc?onglet=plans#haut")).toBe("/groupes/abc?onglet=plans#haut");
  });

  it("refuse les redirections vers un autre site", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "https://mechant.com",
      "//mechant.com",
      "/\\mechant.com",
      "horaire",
      "/\nhttps://mechant.com",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("isPlausibleEmail", () => {
  it("accepte une adresse normale et refuse le reste", () => {
    expect(isPlausibleEmail("ali@exemple.ca")).toBe(true);
    expect(isPlausibleEmail("ali")).toBe(false);
    expect(isPlausibleEmail("ali @exemple.ca")).toBe(false);
  });
});
