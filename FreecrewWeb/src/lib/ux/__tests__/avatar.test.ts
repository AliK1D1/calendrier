import { describe, expect, it } from "vitest";

import { AVATAR_HUES, avatarHue, initials } from "../avatar";

describe("initials", () => {
  it("prend la première lettre du premier et du dernier mot", () => {
    expect(initials("Maya Tremblay")).toBe("MT");
    expect(initials("Jean-Philippe Roy")).toBe("JR");
    expect(initials("  marie  ève  côté ")).toBe("MC");
  });
  it("un seul mot : une lettre", () => {
    expect(initials("ali")).toBe("A");
    expect(initials("élodie")).toBe("É");
  });
  it("nom vide : point d'interrogation", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
  it("ne coupe pas un emoji en deux", () => {
    expect(initials("🦊 Renard")).toBe("🦊R");
  });
});

describe("avatarHue", () => {
  it("est stable et ignore la casse et les espaces autour", () => {
    expect(avatarHue("Maya")).toBe(avatarHue("  maya "));
  });
  it("tombe sur une des teintes régulières", () => {
    for (const n of ["Ali", "Maya Tremblay", "Samuel", "", "🦊"]) {
      const h = avatarHue(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(h % (360 / AVATAR_HUES)).toBe(0);
    }
  });
  it("donne des teintes différentes à des noms différents (en général)", () => {
    const hues = new Set(["Ali", "Maya", "Samuel", "Léa", "Noah", "Emma"].map(avatarHue));
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });
});
