/**
 * Traduction des messages produits côté serveur (erreurs de validation, erreurs de la base,
 * messages des actions). Ces messages sont écrits en français dans `src/lib` (fonctions pures,
 * testées en français) ; en anglais, on les traduit à l'affichage avec ce catalogue.
 * Un message absent du catalogue reste en français (jamais de texte vide).
 */
import type { Locale } from "./config";
import { EN_PATTERNS, EN_TEXTS } from "./serverText.en";

/** Message serveur dans la langue voulue (inchangé en français). */
export function translateServerText(text: string, locale: Locale): string {
  if (locale === "fr") return text;
  const exact = EN_TEXTS[text];
  if (exact !== undefined) return exact;
  for (const [re, to] of EN_PATTERNS) {
    const m = re.exec(text);
    if (m) return to(...m.slice(1));
  }
  return text;
}
