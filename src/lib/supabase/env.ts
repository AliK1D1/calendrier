/**
 * Variables Supabase (publiques : URL du projet et clé « anon », protégées par RLS).
 * Renvoie `null` si elles manquent : l'app compile et s'affiche quand même (pages publiques),
 * et la connexion explique qu'elle n'est pas configurée au lieu de planter.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  // Une URL mal saisie (ex. sans « https:// ») ferait planter le middleware sur chaque page :
  // on la traite comme une configuration absente, et /connexion l'explique.
  if (!isHttpUrl(url)) {
    console.error("NEXT_PUBLIC_SUPABASE_URL invalide : elle doit commencer par https://");
    return null;
  }
  return { url, anonKey };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}
