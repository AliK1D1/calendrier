import "server-only";

import { headers } from "next/headers";

/**
 * Adresse publique du site (ex. http://localhost:3000), pour construire les liens de retour
 * de connexion. NEXT_PUBLIC_SITE_URL a priorité ; sinon on se fie à la requête. Supabase
 * n'accepte de toute façon que les adresses listées dans « Redirect URLs ».
 */
export async function getSiteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
