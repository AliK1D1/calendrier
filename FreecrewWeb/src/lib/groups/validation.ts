/**
 * Groupes : validation des entrées et liens d'invitation (fonctions pures, testées).
 * La base applique les mêmes règles (contraintes et fonctions de la migration 0006).
 */
import { cleanText, type Result } from "@/lib/places/validation";

/** Longueur maximale d'un nom de groupe (contrainte `groups_name_length`). */
export const GROUP_NAME_MAX = 60;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Code d'invitation : 32 caractères hexadécimaux (contrainte `groups_invite_code_format`). */
const INVITE_CODE = /^[0-9a-f]{32}$/;

/** Nom de groupe : 1 à 60 caractères après nettoyage, sans caractère de contrôle. */
export function validateGroupName(raw: unknown): Result<string> {
  if (typeof raw !== "string") return { ok: false, error: "Le nom du groupe est manquant." };
  if (CONTROL_CHARS.test(raw.replace(/[\t\n\r]/g, " "))) {
    return { ok: false, error: "Le nom du groupe contient des caractères invalides." };
  }
  const name = cleanText(raw);
  if (name.length === 0) return { ok: false, error: "Le nom du groupe ne peut pas être vide." };
  if (name.length > GROUP_NAME_MAX) {
    return {
      ok: false,
      error: `Le nom du groupe est trop long (${GROUP_NAME_MAX} caractères au maximum).`,
    };
  }
  return { ok: true, value: name };
}

/** Identifiant (uuid) d'un groupe ou d'une personne. */
export function validateUuid(raw: unknown, error = "Groupe introuvable."): Result<string> {
  return typeof raw === "string" && UUID.test(raw)
    ? { ok: true, value: raw.toLowerCase() }
    : { ok: false, error };
}

/**
 * Code d'invitation tel que tapé ou copié : espaces enlevés, minuscules. Accepte aussi un lien
 * complet (« https://…/rejoindre/<code> ») collé par erreur.
 */
export function normalizeInviteCode(raw: unknown): Result<string> {
  if (typeof raw !== "string") return { ok: false, error: "Code d'invitation invalide." };
  let code = raw.trim();
  const fromLink = /\/rejoindre\/([^/?#\s]+)/.exec(code);
  if (fromLink) code = fromLink[1];
  code = code.replace(/\s+/g, "").toLowerCase();
  return INVITE_CODE.test(code)
    ? { ok: true, value: code }
    : { ok: false, error: "Code d'invitation invalide." };
}

/** Chemin de la page d'invitation (« /rejoindre/<code> »). */
export function invitePath(code: string): string {
  return `/rejoindre/${encodeURIComponent(code)}`;
}

/** Lien d'invitation complet à partager (origine sans « / » final). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${invitePath(code)}`;
}
