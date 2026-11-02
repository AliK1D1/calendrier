import { describe, expect, it } from "vitest";

import {
  GROUP_NAME_MAX,
  inviteUrl,
  normalizeInviteCode,
  validateGroupName,
  validateUuid,
} from "../validation";

const CODE = "0123456789abcdef0123456789abcdef";

describe("validateGroupName", () => {
  it("nettoie les espaces et accepte un nom normal", () => {
    expect(validateGroupName("  Le   cégep ")).toEqual({ ok: true, value: "Le cégep" });
  });
  it("refuse vide, trop long, caractères de contrôle et non-texte", () => {
    expect(validateGroupName("   ").ok).toBe(false);
    expect(validateGroupName("x".repeat(GROUP_NAME_MAX + 1)).ok).toBe(false);
    expect(validateGroupName("x".repeat(GROUP_NAME_MAX)).ok).toBe(true);
    expect(validateGroupName("a\u0000b").ok).toBe(false);
    expect(validateGroupName(42).ok).toBe(false);
  });
});

describe("normalizeInviteCode", () => {
  it("accepte le code, en majuscules ou avec des espaces", () => {
    expect(normalizeInviteCode(CODE)).toEqual({ ok: true, value: CODE });
    expect(normalizeInviteCode(` ${CODE.toUpperCase()} `)).toEqual({ ok: true, value: CODE });
  });
  it("accepte un lien complet collé", () => {
    expect(normalizeInviteCode(`https://exemple.ca/rejoindre/${CODE}?x=1`)).toEqual({
      ok: true,
      value: CODE,
    });
  });
  it("refuse un code trop court, trop long ou avec d'autres caractères", () => {
    expect(normalizeInviteCode("abc123").ok).toBe(false);
    expect(normalizeInviteCode(CODE + "0").ok).toBe(false);
    expect(normalizeInviteCode(CODE.slice(0, 31) + "g").ok).toBe(false);
    expect(normalizeInviteCode("../../etc").ok).toBe(false);
    expect(normalizeInviteCode(null).ok).toBe(false);
  });
});

describe("validateUuid / inviteUrl", () => {
  it("valide un uuid et le met en minuscules", () => {
    expect(validateUuid("00000000-0000-4000-8000-00000000000A")).toEqual({
      ok: true,
      value: "00000000-0000-4000-8000-00000000000a",
    });
    expect(validateUuid("pas-un-uuid")).toEqual({ ok: false, error: "Groupe introuvable." });
  });
  it("construit le lien sans double barre oblique", () => {
    expect(inviteUrl("http://localhost:3000/", CODE)).toBe(
      `http://localhost:3000/rejoindre/${CODE}`,
    );
  });
});
