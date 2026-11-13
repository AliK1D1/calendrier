import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabaseEnv } from "../env";

describe("getSupabaseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renvoie l'URL et la clé quand elles sont valides", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://abc.supabase.co ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle");
    expect(getSupabaseEnv()).toEqual({ url: "https://abc.supabase.co", anonKey: "cle" });
  });

  it("traite une URL sans https:// comme une configuration absente", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle");
    expect(getSupabaseEnv()).toBeNull();
  });

  it("répare une clé collée sur plusieurs lignes et une URL avec / final", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJ.ab\ncd.\r\nef ");
    expect(getSupabaseEnv()).toEqual({ url: "https://abc.supabase.co", anonKey: "eyJ.abcd.ef" });
  });

  it("renvoie null si une variable manque", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle");
    expect(getSupabaseEnv()).toBeNull();
  });
});
