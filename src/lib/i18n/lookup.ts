/**
 * Lecture sûre d'un catalogue de textes : seules les clés propres comptent. Sans cela,
 * `catalogue["constructor"]` ou `catalogue["__proto__"]` renvoie une fonction ou un objet
 * hérité, pas un texte (revue PR #20).
 */
import type { Messages } from "./messages";

/** Texte de `record` pour `key`, ou `undefined` si la clé n'est pas à lui (ou pas un texte). */
export function ownText(record: Readonly<Record<string, string>>, key: string): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Message d'erreur de connexion pour le code `?erreur=…` de l'adresse, ou `undefined`. */
export function authErrorMessage(t: Messages, code: string | undefined): string | undefined {
  return code ? ownText(t.auth.errors, code) : undefined;
}
