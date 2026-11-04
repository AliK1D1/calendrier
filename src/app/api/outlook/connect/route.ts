import { NextResponse } from "next/server";

import { getSiteOrigin } from "@/lib/auth/origin";
import { getOutlookConfig } from "@/lib/outlook/config";
import { buildAuthorizeUrl, createOAuthState, OAUTH_STATE_TTL_MS } from "@/lib/outlook/oauth";
import { callbackUrl, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/outlook/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** « Connecter Outlook » : envoie la personne à la page de connexion Microsoft. */
export async function GET() {
  const origin = await getSiteOrigin();
  const back = (code: string) =>
    NextResponse.redirect(new URL(`/profil?outlook=${code}#outlook`, origin), 303);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/connexion?erreur=config", origin), 303);
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/connexion?next=/profil", origin), 303);
  }
  const config = getOutlookConfig();
  if (!config) return back("non-configure");

  const { cookie, state, codeChallenge } = createOAuthState(
    data.user.id,
    config.tokenKey,
    new Date(),
  );
  const res = NextResponse.redirect(
    buildAuthorizeUrl(config, { redirectUri: callbackUrl(origin), state, codeChallenge }),
    303,
  );
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // « lax » : le cookie revient avec la redirection de Microsoft (navigation GET).
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
