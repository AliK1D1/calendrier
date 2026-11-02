import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "email",
  "invite",
  "recovery",
  "email_change",
];

/**
 * Retour de connexion (lien magique ou Google).
 * - `?code=…` : flux PKCE par défaut de @supabase/ssr (même navigateur que la demande).
 * - `?token_hash=…&type=…` : si le modèle de courriel Supabase est personnalisé (fonctionne
 *   aussi quand le lien est ouvert dans un autre navigateur ; voir README).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/connexion?erreur=config", origin));
  }

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error) console.error("Callback (code) :", error.message);
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
    if (error) console.error("Callback (token_hash) :", error.message);
  }

  if (!ok) {
    const url = new URL("/connexion", origin);
    const providerError =
      searchParams.get("error") && searchParams.get("error_code") !== "otp_expired";
    url.searchParams.set("erreur", providerError ? "echec" : "lien");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(next, origin));
}
