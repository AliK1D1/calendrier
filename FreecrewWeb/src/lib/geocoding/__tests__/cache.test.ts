import { describe, expect, it } from "vitest";

import { createTtlCache } from "../cache";

describe("createTtlCache", () => {
  it("rend une valeur tant qu'elle n'est pas expirée", () => {
    let t = 0;
    const cache = createTtlCache<string>({ maxEntries: 10, ttlMs: 1000, now: () => t });
    cache.set("a", "A");
    t = 999;
    expect(cache.get("a")).toBe("A");
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("garde au plus maxEntries et sort la moins récemment utilisée", () => {
    const cache = createTtlCache<number>({ maxEntries: 2, ttlMs: 60_000, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // « a » redevient récent
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("remplacer une clé repousse son expiration", () => {
    let t = 0;
    const cache = createTtlCache<string>({ maxEntries: 5, ttlMs: 100, now: () => t });
    cache.set("a", "v1");
    t = 80;
    cache.set("a", "v2");
    t = 150;
    expect(cache.get("a")).toBe("v2");
  });
});
