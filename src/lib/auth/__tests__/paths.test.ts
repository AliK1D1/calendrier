import { describe, expect, it } from "vitest";

import {
  afterLoginPath,
  isApiPath,
  isPlausibleEmail,
  isPublicPath,
  otpErrorCode,
  safeNextPath,
} from "../paths";

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

  it("refuse les chemins qui deviennent « //site » une fois normalisés (revue)", () => {
    for (const bad of ["/.//mechant.com", "/a/..//mechant.com", "/%2e%2e//mechant.com", "/.///x"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
    // Les chemins internes avec « . » ou « .. » restent acceptés, normalisés.
    expect(safeNextPath("/groupes/../horaire")).toBe("/horaire");
    expect(safeNextPath("/./lieux?x=1")).toBe("/lieux?x=1");
  });
});

describe("isPlausibleEmail", () => {
  it("accepte une adresse normale et refuse le reste", () => {
    expect(isPlausibleEmail("ali@exemple.ca")).toBe(true);
    expect(isPlausibleEmail("ali")).toBe(false);
    expect(isPlausibleEmail("ali @exemple.ca")).toBe(false);
  });
});

describe("isApiPath", () => {
  it("reconnaît /api et /api/*", () => {
    expect(isApiPath("/api/geocode")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apiculture")).toBe(false);
    expect(isApiPath("/lieux")).toBe(false);
  });
});

describe("afterLoginPath", () => {
  it("envoie vers l'accueil de première connexion en gardant la destination", () => {
    expect(afterLoginPath("/lieux", false)).toBe("/bienvenue?next=%2Flieux");
    expect(afterLoginPath(undefined, false)).toBe("/bienvenue?next=%2F");
  });

  it("va directement à la destination si l'accueil est fait ou inconnu", () => {
    expect(afterLoginPath("/lieux", true)).toBe("/lieux");
    expect(afterLoginPath("/lieux", null)).toBe("/lieux");
  });

  it("ne boucle pas et garde la protection contre les redirections ouvertes", () => {
    expect(afterLoginPath("/bienvenue", false)).toBe("/bienvenue");
    expect(afterLoginPath("https://mechant.com", false)).toBe("/bienvenue?next=%2F");
    expect(afterLoginPath("/.//mechant.com", true)).toBe("/");
  });
});

describe("otpErrorCode", () => {
  it("reconnaît la limite d'envoi de courriels de Supabase", () => {
    expect(otpErrorCode({ status: 429, message: "email rate limit exceeded" })).toBe("limite");
    expect(otpErrorCode({ code: "over_email_send_rate_limit" })).toBe("limite");
  });

  it("renvoie l'erreur générique sinon", () => {
    expect(otpErrorCode({ status: 500, message: "Error sending magic link email" })).toBe("envoi");
  });
});
