import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/paths";

import {
  DEFAULT_SITE_URL,
  INDEXABLE_PATHS,
  PRIVATE_PATHS,
  googleVerification,
  isIndexable,
  siteUrl,
} from "../site";

describe("siteUrl", () => {
  it("prend NEXT_PUBLIC_SITE_URL en priorité, sans barre finale", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://freecrew.ca/",
        VERCEL_PROJECT_PRODUCTION_URL: "x.app",
      }),
    ).toBe("https://freecrew.ca");
  });

  it("utilise le domaine de production de Vercel (sans protocole)", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "calendrier-opal.vercel.app" })).toBe(
      "https://calendrier-opal.vercel.app",
    );
  });

  it("retombe sur l'adresse actuelle si rien n'est défini ou si la valeur est invalide", () => {
    expect(siteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "   " })).toBe(DEFAULT_SITE_URL);
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://" })).toBe(DEFAULT_SITE_URL);
  });
});

describe("isIndexable", () => {
  it("indexe la production et le local, pas les aperçus", () => {
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(isIndexable({})).toBe(true);
    expect(isIndexable({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("googleVerification", () => {
  it("accepte le code seul ou la balise complète", () => {
    expect(googleVerification({ GOOGLE_SITE_VERIFICATION: " abc123 " })).toBe("abc123");
    expect(
      googleVerification({
        GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="xyz-789" />',
      }),
    ).toBe("xyz-789");
    expect(googleVerification({})).toBeUndefined();
  });
});

describe("pages", () => {
  it("les pages indexées sont publiques et les pages privées ne le sont pas", () => {
    for (const p of INDEXABLE_PATHS) expect(isPublicPath(p)).toBe(true);
    for (const p of PRIVATE_PATHS.filter((p) => !p.startsWith("/auth"))) {
      expect(isPublicPath(p.replace(/\/$/, ""))).toBe(false);
    }
  });
});
