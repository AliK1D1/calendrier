import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { isApiPath, isPublicPath } from "@/lib/auth/paths";

import { getSupabaseEnv } from "./env";

/**
 * Rafraîchit la session Supabase (cookies) à chaque requête et protège les pages :
 * un visiteur non connecté qui demande une page protégée est envoyé vers /connexion?next=…
 * Sans configuration Supabase, les pages protégées renvoient vers /connexion?erreur=config.
 * Les routes /api/* répondent 401 (JSON) au lieu d'être redirigées.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const env = getSupabaseEnv();

  if (!env) {
    if (isApiPath(pathname)) return unauthorized();
    return isPublicPath(pathname)
      ? NextResponse.next({ request })
      : redirectToLogin(request, pathname + search, "config");
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Ne rien mettre entre createServerClient et getUser (recommandation @supabase/ssr).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isApiPath(pathname)) {
    const res = unauthorized();
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  }

  if (!user && !isPublicPath(pathname)) {
    const redirect = redirectToLogin(request, pathname + search);
    // Garder les cookies éventuellement mis à jour (ex. session expirée effacée).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

function redirectToLogin(request: NextRequest, next: string, erreur?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/connexion";
  url.search = "";
  url.searchParams.set("next", next);
  if (erreur) url.searchParams.set("erreur", erreur);
  return NextResponse.redirect(url);
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
}
