/**
 * Règles de navigation liées à la connexion (fonctions pures, testées).
 */

/** Pages accessibles sans être connecté : l'accueil, /connexion et tout /auth/*. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/connexion" ||
    pathname.startsWith("/connexion/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  );
}

/** Page d'arrivée par défaut après la connexion. */
export const DEFAULT_AFTER_LOGIN = "/";

/**
 * Chemin de retour après connexion (paramètre `next`), sécurisé : seulement un chemin interne
 * (« /horaire?x=1 »). Refuse les URL absolues, « //site.com », « /\\site.com » et les
 * caractères de contrôle, pour éviter une redirection vers un autre site.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return DEFAULT_AFTER_LOGIN;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return DEFAULT_AFTER_LOGIN;
  try {
    const url = new URL(next, "http://interne.invalid");
    if (url.origin !== "http://interne.invalid") return DEFAULT_AFTER_LOGIN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}

/** Messages d'erreur affichés sur /connexion, selon le code dans l'URL (`?erreur=`). */
export const LOGIN_ERRORS: Record<string, string> = {
  config:
    "La connexion n'est pas encore configurée (variables Supabase manquantes). Voir le README.",
  lien: "Ce lien de connexion est invalide ou expiré. Demande un nouveau lien.",
  courriel: "Adresse courriel invalide.",
  envoi: "Impossible d'envoyer le lien pour l'instant. Réessaie dans une minute.",
  echec: "La connexion n'a pas abouti. Réessaie.",
  google: "La connexion avec Google n'a pas fonctionné. Réessaie ou utilise ton courriel.",
};

/** Validation simple d'une adresse courriel (le vrai contrôle est fait par Supabase). */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
