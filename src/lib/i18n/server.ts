import "server-only";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, type Locale, resolveLocale } from "./config";
import { getMessages, type Messages } from "./messages";
import { translateServerText } from "./serverText";

/** Langue de la requête (cookie `langue`), français par défaut. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}

/** Langue et textes de la requête, pour les composants serveur et les actions. */
export async function getI18n(): Promise<{
  locale: Locale;
  t: Messages;
  tr: (serverText: string) => string;
}> {
  const locale = await getLocale();
  return {
    locale,
    t: getMessages(locale),
    tr: (serverText: string) => translateServerText(serverText, locale),
  };
}
