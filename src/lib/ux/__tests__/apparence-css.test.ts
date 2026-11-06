/**
 * Revue PR #18 : chaque accent de ACCENTS a sa teinte et sa saturation dans globals.css, et
 * l'accent par défaut est posé sur :root. Sans cela, `--primary` est invalide et les boutons
 * principaux deviennent transparents (accent bleu, ou script d'apparence pas encore lancé).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCENT_PAR_DEFAUT, ACCENTS } from "../apparence";

const CSS = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

/** Valeurs de `--teinte` et `--chroma` du premier bloc dont le sélecteur est exactement `selecteur`. */
function variables(selecteur: string): { teinte: number; chroma: number } | null {
  const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bloc = new RegExp(`(?:^|\\n)${echappe}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1];
  if (!bloc) return null;
  const teinte = /--teinte:\s*([\d.]+)\s*;/.exec(bloc)?.[1];
  const chroma = /--chroma:\s*([\d.]+)\s*;/.exec(bloc)?.[1];
  return teinte && chroma ? { teinte: Number(teinte), chroma: Number(chroma) } : null;
}

describe("Revue PR #18 : couleurs d'accent dans globals.css", () => {
  it(":root a l'accent par défaut (sans data-accent, ou avec l'accent bleu)", () => {
    const defaut = ACCENTS.find((a) => a.id === ACCENT_PAR_DEFAUT)!;
    expect(variables(":root")).toEqual({ teinte: defaut.teinte, chroma: defaut.chroma });
  });

  it("chaque autre accent a son bloc [data-accent=…] avec les mêmes valeurs", () => {
    for (const a of ACCENTS) {
      if (a.id === ACCENT_PAR_DEFAUT) continue;
      expect(variables(`[data-accent="${a.id}"]`), a.id).toEqual({
        teinte: a.teinte,
        chroma: a.chroma,
      });
    }
  });
});
