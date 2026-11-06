/**
 * Revue PR #20 : un texte qui porte le nom d'une propriété d'objet (« constructor »,
 * « toString », « __proto__ »…) n'est pas une traduction. Avant, `EN_TEXTS[texte]` renvoyait
 * la fonction ou l'objet hérité, affiché comme « function toString() { [native code] } ».
 */
import { describe, expect, it } from "vitest";

import { getMessages } from "../messages";
import { authErrorMessage } from "../lookup";
import { translateServerText } from "../serverText";

const HERITES = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

describe("Revue PR #20 : clés héritées", () => {
  it("translateServerText rend le texte tel quel", () => {
    for (const k of HERITES) {
      expect(translateServerText(k, "en")).toBe(k);
      expect(translateServerText(`Séance non déplacée : ${k}`, "en")).toBe(
        `Session not moved: ${k}`,
      );
      expect(translateServerText(`Lundi, 9 h : ${k}`, "en")).toBe(`Lundi, 9 h: ${k}`);
    }
  });

  it("un code d'erreur de connexion inconnu (?erreur=…) ne donne aucun message", () => {
    for (const locale of ["fr", "en"] as const) {
      const t = getMessages(locale);
      for (const k of HERITES) expect(authErrorMessage(t, k)).toBeUndefined();
      expect(authErrorMessage(t, "lien")).toBe(t.auth.errors.lien);
      expect(authErrorMessage(t, undefined)).toBeUndefined();
    }
  });

  it("les traductions connues marchent comme avant", () => {
    expect(translateServerText("Bloc introuvable.", "en")).toBe("Block not found.");
    expect(translateServerText("Séance non déplacée : Bloc introuvable.", "en")).toBe(
      "Session not moved: Block not found.",
    );
    expect(translateServerText("Bloc introuvable.", "fr")).toBe("Bloc introuvable.");
  });
});
