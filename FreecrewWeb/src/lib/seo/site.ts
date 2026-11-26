/**
 * Référencement (Google) : adresse publique du site et pages à indexer (fonctions pures).
 */

/** Adresse de production actuelle, utilisée si aucune variable n'est définie. */
export const DEFAULT_SITE_URL = "https://calendrier-opal.vercel.app";

/** Pages publiques montrées aux moteurs de recherche (le reste demande une connexion). */
export const INDEXABLE_PATHS = ["/", "/inscription", "/connexion"] as const;

/** Pages privées que les robots n'ont pas à visiter (elles renvoient vers /connexion). */
export const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/bienvenue",
  "/etude",
  "/groupes",
  "/horaire",
  "/lieux",
  "/plans",
  "/profil",
  "/rejoindre",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Ajoute https:// au besoin et retire la barre oblique finale. */
function normaliser(adresse: string): string | null {
  const brut = adresse.trim();
  if (!brut) return null;
  const avecProtocole = /^https?:\/\//i.test(brut) ? brut : `https://${brut}`;
  try {
    const url = new URL(avecProtocole);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Adresse publique canonique du site, sans barre finale. Ordre : NEXT_PUBLIC_SITE_URL, puis le
 * domaine de production fourni par Vercel (VERCEL_PROJECT_PRODUCTION_URL), puis l'adresse
 * actuelle. Ainsi les aperçus Vercel pointent quand même vers le site de production.
 */
export function siteUrl(env: Env): string {
  return (
    normaliser(env.NEXT_PUBLIC_SITE_URL ?? "") ??
    normaliser(env.VERCEL_PROJECT_PRODUCTION_URL ?? "") ??
    DEFAULT_SITE_URL
  );
}

/**
 * Le site peut-il être indexé ? Non sur les aperçus Vercel (VERCEL_ENV=preview), pour que
 * Google ne garde que le site de production.
 */
export function isIndexable(env: Env): boolean {
  return env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "development";
}

/** Code de validation Google Search Console (balise meta), ou undefined. */
export function googleVerification(env: Env): string | undefined {
  const code = env.GOOGLE_SITE_VERIFICATION?.trim();
  if (!code) return undefined;
  // On accepte aussi la balise complète collée telle quelle depuis Search Console.
  const balise = /content=["']([^"']+)["']/.exec(code);
  return balise ? balise[1] : code;
}
