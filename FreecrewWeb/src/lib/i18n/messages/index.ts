import type { Locale } from "../config";
import { en } from "./en";
import { fr, type Messages } from "./fr";

export type { Messages };

const MESSAGES: Record<Locale, Messages> = { fr, en };

/** Textes de l'interface dans une langue. */
export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}
