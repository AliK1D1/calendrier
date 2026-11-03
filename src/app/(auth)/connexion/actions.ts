"use server";

import { redirect } from "next/navigation";

import { getSiteOrigin } from "@/lib/auth/origin";
import { afterLoginPath, isPlausibleEmail, otpErrorCode, safeNextPath } from "@/lib/auth/paths";
import { getOnboardingStatus } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function loginUrl(params: Record<string, string>): string {
  return `/connexion?${new URLSearchParams(params).toString()}`;
}

async function callbackUrl(next: string): Promise<string> {
  const origin = await getSiteOrigin();
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/** Envoie un lien magique par courriel (crée le compte s'il n'existe pas). */
export async function envoyerLienMagique(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  if (!isPlausibleEmail(email)) redirect(loginUrl({ erreur: "courriel", next }));

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(loginUrl({ erreur: "config", next }));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: await callbackUrl(next), shouldCreateUser: true },
  });
  if (error) {
    console.error("Lien magique :", error.status, error.code, error.message);
    redirect(loginUrl({ erreur: otpErrorCode(error), next }));
  }
  redirect(loginUrl({ envoye: "1", next }));
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
 * Connexion par courriel + mot de passe. Sert surtout aux comptes créés à la main dans
 * Supabase (Authentication → Users → Add user, « Auto Confirm »), sans envoyer de courriel.
 */
export async function connexionMotDePasse(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const password = formData.get("password")?.toString() ?? "";
  if (!isPlausibleEmail(email) || password.length === 0 || password.length > 200) {
    redirect(loginUrl({ erreur: "motdepasse", next }));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(loginUrl({ erreur: "config", next }));

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Mot de passe :", error.status, error.code, error.message);
    const code = error.status === 429 ? "limite" : "motdepasse";
    redirect(loginUrl({ erreur: code, next }));
  }
  const onboarded = await getOnboardingStatus(supabase);
  redirect(afterLoginPath(next, onboarded));
}
