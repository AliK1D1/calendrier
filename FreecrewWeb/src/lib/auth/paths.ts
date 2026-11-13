/**
 * Règles de navigation liées à la connexion (fonctions pures, testées).
 */

/** Pages accessibles sans être connecté : l'accueil, /connexion, /inscription et /auth/*. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/connexion" ||
    pathname.startsWith("/connexion/") ||
    pathname === "/inscription" ||
    pathname.startsWith("/inscription/") ||
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
    // La normalisation des « . » et « .. » peut recréer un « // » au début :
    // « /.//mechant.com » devient « //mechant.com », que le navigateur lit comme un autre
    // site. On revérifie donc le chemin final.
    if (url.pathname.startsWith("//")) return DEFAULT_AFTER_LOGIN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}

/** Validation simple d'une adresse courriel (le vrai contrôle est fait par Supabase). */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Routes d'API : sans session, réponse 401 en JSON au lieu d'une redirection vers /connexion. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Page d'accueil de première connexion (maison, cégep, mode de transport). */
export const ONBOARDING_PATH = "/bienvenue";

/**
 * Où aller après la connexion : l'accueil de première connexion si le profil ne l'a pas encore
 * fait (`onboarded === false`), sinon `next`. `onboarded === null` (profil illisible, ex.
 * migration 0003 pas encore appliquée) : on ne bloque pas, on va à `next`.
 */
export function afterLoginPath(next: string | null | undefined, onboarded: boolean | null): string {
  const target = safeNextPath(next);
  if (onboarded !== false) return target;
  if (target === ONBOARDING_PATH || target.startsWith(`${ONBOARDING_PATH}?`)) return target;
  return `${ONBOARDING_PATH}?${new URLSearchParams({ next: target }).toString()}`;
}
