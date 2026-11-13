import { type NextRequest, NextResponse } from "next/server";

import { getSiteOrigin } from "@/lib/auth/origin";
import { verifyOAuthState } from "@/lib/outlook/oauth";
import { callbackUrl, OAUTH_COOKIE, OAUTH_COOKIE_PATH, outlookDeps } from "@/lib/outlook/server";
import { completeOutlookConnection } from "@/lib/outlook/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Microsoft peut être lent (plusieurs pages d'événements). Si la fonction est coupée, le
// verrou de synchro expire seul après 2 min.
export const maxDuration = 60;

/** Retour de Microsoft après « Connecter Outlook ». */
export async function GET(request: NextRequest) {
  const origin = await getSiteOrigin();
  const back = (code: string) => {
    const res = NextResponse.redirect(new URL(`/profil?outlook=${code}#outlook`, origin), 303);
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/connexion?erreur=config", origin), 303);
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/connexion?next=/profil", origin), 303);
  const deps = outlookDeps(supabase, data.user.id);
  if (!deps) return back("non-configure");

  const params = request.nextUrl.searchParams;
  // Refus de la personne (ou erreur chez Microsoft) : rien n'est enregistré.
  if (params.get("error")) {
    return back(params.get("error") === "access_denied" ? "refuse" : "echec");
  }
  const verified = verifyOAuthState(
    request.cookies.get(OAUTH_COOKIE)?.value,
    params.get("state"),
    data.user.id,
    deps.config.tokenKey,
    new Date(),
  );
  const code = params.get("code");
  if (!verified || !code || code.length > 4096) return back("expire");

  const r = await completeOutlookConnection(deps, {
    code,
    redirectUri: callbackUrl(origin),
    codeVerifier: verified.codeVerifier,
  });
  if (!r.ok) return back("echec");
  return back(r.sync.status === "error" ? "connecte-erreur" : "connecte");
}
