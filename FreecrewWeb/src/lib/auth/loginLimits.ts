/**
 * Limites de tentatives de connexion (revue de sécurité). Les actions serveur appellent
 * Supabase depuis le serveur : Supabase voit donc l'adresse IP du SERVEUR pour tout le monde.
 * Sa propre limite par IP (quelques dizaines de connexions par 5 min) est alors partagée par
 * tous les utilisateurs, et une seule personne qui essaie des mots de passe en boucle (ou
 * crée des comptes en boucle) bloquerait la connexion de tous. On limite donc d'abord ici,
 * par adresse IP du visiteur et par courriel.
 *
 * En mémoire, une par instance du serveur : c'est une protection de base, pas un compteur
 * partagé (voir la note de revue).
 */
import { createKeyedLimiter, type KeyedLimiter } from "@/lib/geocoding/rateLimiter";

const MINUTE = 60_000;

export interface LoginLimiters {
  perIp: KeyedLimiter;
  perEmail: KeyedLimiter;
}

/**
 * Mot de passe : 50 essais par 15 min par IP (assez pour tout un cégep derrière la même
 * adresse IP), 10 essais par 15 min par courriel.
 */
export function createPasswordLimiters(now?: () => number): LoginLimiters {
  return {
    perIp: createKeyedLimiter({ limit: 50, windowMs: 15 * MINUTE, now }),
    perEmail: createKeyedLimiter({ limit: 10, windowMs: 15 * MINUTE, now }),
  };
}

/** Création de compte : 20 par heure par IP, 5 essais par heure par courriel. */
export function createSignupLimiters(now?: () => number): LoginLimiters {
  return {
    perIp: createKeyedLimiter({ limit: 20, windowMs: 60 * MINUTE, now }),
    perEmail: createKeyedLimiter({ limit: 5, windowMs: 60 * MINUTE, now }),
  };
}

/** Vrai si la tentative est permise (compte la tentative pour l'IP et pour le courriel). */
export function allowLoginAttempt(limiters: LoginLimiters, ip: string, email: string): boolean {
  const ipOk = limiters.perIp.tryAcquire(ip);
  const emailOk = limiters.perEmail.tryAcquire(email);
  return ipOk && emailOk;
}

/**
 * Adresse IP du visiteur. Sur Vercel, `x-forwarded-for` est réécrit par la plateforme : sa
 * première valeur est l'IP du client. Ailleurs (en local), on se rabat sur « inconnue ».
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  return h.get("x-real-ip")?.trim().slice(0, 64) || "inconnue";
}
