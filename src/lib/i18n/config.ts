/**
 * Langues de l'interface (fonctions pures, sans React ni Next). Le français (Québec) est la
 * langue par défaut ; la langue choisie est gardée dans un cookie.
 */

export const LOCALES = ["fr", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

/** Cookie qui garde la langue choisie (un an). */
export const LOCALE_COOKIE = "langue";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Valeur de l'attribut `lang` de `<html>` et des formats `Intl`. */
export const HTML_LANG: Record<Locale, string> = { fr: "fr-CA", en: "en-CA" };

/** Nom de chaque langue, écrit dans cette langue (pour le sélecteur). */
export const LOCALE_NAMES: Record<Locale, string> = { fr: "Français", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Langue d'une valeur de cookie ; la langue par défaut si elle est absente ou inconnue. */
export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
