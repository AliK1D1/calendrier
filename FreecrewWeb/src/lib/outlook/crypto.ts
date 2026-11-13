/**
 * Chiffrement des secrets Outlook (jeton de rafraîchissement, état OAuth) avec AES-256-GCM.
 *
 * Format : `v1.<iv>.<tag>.<texte chiffré>` (base64url). Les « données associées » (AAD)
 * lient le texte chiffré à son usage et à son propriétaire (ex. `refresh:<uuid>`) : le jeton
 * chiffré d'une personne, recopié dans la ligne d'une autre, ne se déchiffre pas.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string, key: Buffer, aad: string): string {
  if (key.length !== 32) throw new Error("Clé de chiffrement invalide.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

/** Déchiffre ; `null` si le texte est illisible, modifié, ou chiffré pour un autre usage. */
export function decryptSecret(sealed: string, key: Buffer, aad: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || key.length !== 32) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** AAD du jeton de rafraîchissement d'une personne. */
export const refreshTokenAad = (ownerId: string) => `outlook-refresh:${ownerId}`;
