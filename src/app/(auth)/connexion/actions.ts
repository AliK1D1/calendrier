"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { allowLoginAttempt, clientIp, createPasswordLimiters } from "@/lib/auth/loginLimits";
import { getSiteOrigin } from "@/lib/auth/origin";
import { afterLoginPath, isPlausibleEmail, safeNextPath } from "@/lib/auth/paths";
import { getOnboardingStatus } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const passwordLimiters = createPasswordLimiters();

function loginUrl(params: Record<string, string>): string {
  return `/connexion?${new URLSearchParams(params).toString()}`;
}

async function callbackUrl(next: string): Promise<string> {
  const origin = await getSiteOrigin();
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/** Démarre la connexion avec Google (redirige vers Google). */
export async function connexionGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(loginUrl({ erreur: "config", next }));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(next) },
  });
  if (error || !data.url) {
    console.error("Google :", error?.message);
    redirect(loginUrl({ erreur: "google", next }));
  }
  redirect(data.url);
}

/**
 * Connexion par courriel + mot de passe (comptes créés sur /inscription, ou à la main dans
 * Supabase : Authentication → Users → Add user, « Auto Confirm »). Plus de lien par courriel.
 */
export async function connexionMotDePasse(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const password = formData.get("password")?.toString() ?? "";
  if (!isPlausibleEmail(email) || password.length === 0 || password.length > 200) {
    redirect(loginUrl({ erreur: "motdepasse", next }));
  }
  if (!allowLoginAttempt(passwordLimiters, clientIp(await headers()), email)) {
    redirect(loginUrl({ erreur: "essais", next }));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(loginUrl({ erreur: "config", next }));

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Mot de passe :", error.status, error.code, error.message);
    const code =
      error.status === 429
        ? "limite"
        : error.code === "email_not_confirmed"
          ? "confirmer"
          : "motdepasse";
    redirect(loginUrl({ erreur: code, next }));
  }
  const onboarded = await getOnboardingStatus(supabase);
  redirect(afterLoginPath(next, onboarded));
}
