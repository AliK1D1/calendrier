"use client";

import { createContext, type ReactNode, useContext } from "react";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { getMessages, type Messages } from "./messages";
import { translateServerText } from "./serverText";

const I18nContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Donne la langue aux composants client. Seule la langue (une chaîne) passe du serveur au
 * client : les textes, qui contiennent des fonctions, sont importés ici.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

/** Langue et textes courants, dans un composant client. */
export function useI18n(): {
  locale: Locale;
  t: Messages;
  /** Message renvoyé par le serveur (erreur d'action…), traduit si besoin. */
  tr: (serverText: string) => string;
} {
  const locale = useContext(I18nContext);
  return {
    locale,
    t: getMessages(locale),
    tr: (serverText: string) => translateServerText(serverText, locale),
  };
}
