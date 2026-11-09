import { describe, expect, it } from "vitest";

import {
  isValidUsername,
  normalizeUsername,
  passwordProblems,
  signUpErrorCode,
  validateSignup,
} from "../signup";

describe("nom d'utilisateur", () => {
  it("normalise en minuscules, sans espaces autour", () => {
    expect(normalizeUsername("  Ali_K ")).toBe("ali_k");
  });

  it("accepte lettres, chiffres, « _ » et « . », de 3 à 20 caractères", () => {
    for (const u of ["ali", "ali.k", "ali_2005", "a".repeat(20), "007"]) {
      expect(isValidUsername(u)).toBe(true);
    }
  });

  it("refuse le reste", () => {
    for (const u of ["al", "a".repeat(21), "_ali", ".ali", "ali k", "Ali", "élise", "ali@x", ""]) {
      expect(isValidUsername(u)).toBe(false);
    }
  });
});

describe("passwordProblems", () => {
  it("accepte 8 caractères avec majuscule, minuscule et chiffre", () => {
    expect(passwordProblems("Bonjour1")).toEqual([]);
    expect(passwordProblems("Été2026x")).toEqual([]);
  });

  it("liste ce qui manque", () => {
    expect(passwordProblems("Bonj1")).toEqual(["court"]);
    expect(passwordProblems("bonjour12")).toEqual(["majuscule"]);
    expect(passwordProblems("BONJOUR12")).toEqual(["minuscule"]);
    expect(passwordProblems("Bonjourrr")).toEqual(["chiffre"]);
    expect(passwordProblems("")).toEqual(["court", "majuscule", "minuscule", "chiffre"]);
    expect(passwordProblems(`A1${"a".repeat(71)}`)).toEqual(["long"]);
  });
});

describe("validateSignup", () => {
  const ok = {
    email: "ali@example.com",
    username: "ali",
    password: "Bonjour1",
    confirm: "Bonjour1",
  };

  it("formulaire valide", () => {
    expect(validateSignup(ok)).toBeNull();
  });

  it("donne la première erreur", () => {
    expect(validateSignup({ ...ok, email: "ali" })).toBe("courriel");
    expect(validateSignup({ ...ok, username: "a" })).toBe("nom");
    expect(validateSignup({ ...ok, password: "court", confirm: "court" })).toBe("motdepasse");
    expect(validateSignup({ ...ok, confirm: "Bonjour2" })).toBe("confirmation");
  });
});

describe("signUpErrorCode", () => {
  it("reconnaît les erreurs de Supabase", () => {
    expect(signUpErrorCode({ status: 429, message: "email rate limit exceeded" })).toBe("limite");
    expect(signUpErrorCode({ code: "user_already_exists", status: 422 })).toBe("existe");
    expect(signUpErrorCode({ message: "User already registered" })).toBe("existe");
    expect(signUpErrorCode({ code: "weak_password" })).toBe("motdepasse");
    expect(signUpErrorCode({ status: 500, message: "Database error saving new user" })).toBe(
      "pris",
    );
    expect(signUpErrorCode({ status: 500, message: "autre" })).toBe("echec");
  });
});
