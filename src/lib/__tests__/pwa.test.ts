/**
 * Bonus PWA (segment 18) : le manifeste et les icônes de l'app installable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { config } from "@/middleware";

const PUBLIC = join(__dirname, "../../../public");

/** Le `matcher` lu comme une expression régulière (même sens que dans Next.js). */
function passesThroughMiddleware(pathname: string): boolean {
  return config.matcher.some((m) => new RegExp(`^${m}$`).test(pathname));
}

describe("manifeste (PWA)", () => {
  const m = manifest();

  it("décrit une app installable en français, ouverte sur l'accueil", () => {
    expect(m.name).toBe("Freecrew");
    expect(m.short_name && m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.lang).toBe("fr-CA");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("a des icônes 192 et 512 (dont une « maskable ») qui existent dans public/", () => {
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.type === "image/png")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const file = join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === "image/png") {
        // Signature PNG, puis largeur et hauteur de l'en-tête IHDR.
        const buf = readFileSync(file);
        expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
        const [w, h] = (icon.sizes ?? "").split("x").map(Number);
        expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([w, h]);
      }
    }
    expect(existsSync(join(PUBLIC, "apple-touch-icon.png"))).toBe(true);
  });

  it("le manifeste et les icônes sont publics (sans session) ; les pages restent protégées", () => {
    expect(passesThroughMiddleware("/manifest.webmanifest")).toBe(false);
    expect(passesThroughMiddleware("/icon-192.png")).toBe(false);
    expect(passesThroughMiddleware("/apple-touch-icon.png")).toBe(false);
    expect(passesThroughMiddleware("/groupes")).toBe(true);
    expect(passesThroughMiddleware("/groupes/abc.webmanifest")).toBe(true);
    expect(passesThroughMiddleware("/api/geocode")).toBe(true);
  });
});
