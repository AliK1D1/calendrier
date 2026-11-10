/**
 * Pastille d'une personne (initiales et couleur), pour reconnaître les membres d'un coup
 * d'œil dans les listes. Fonctions pures : la même personne a toujours la même couleur.
 */

/** Initiales d'un nom : « Maya Tremblay » → « MT », « ali » → « A », vide → « ? ». */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_.]+/u)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]][0] ?? "?";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toLocaleUpperCase("fr-CA");
}

/** Nombre de teintes distinctes (réparties sur le cercle des couleurs). */
export const AVATAR_HUES = 12;

/** Teinte (0 à 359) tirée du nom, parmi `AVATAR_HUES` teintes régulières. */
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLocaleLowerCase("fr-CA")) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  }
  return (h % AVATAR_HUES) * (360 / AVATAR_HUES);
}
