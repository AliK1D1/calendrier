"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { allowLoginAttempt, clientIp, createSignupLimiters } from "@/lib/auth/loginLimits";
import { afterLoginPath, safeNextPath } from "@/lib/auth/paths";
import {
  normalizeUsername,
  signUpErrorCode,
  type SignupErrorCode,
  validateSignup,
} from "@/lib/auth/signup";
import { getOnboardingStatus } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const signupLimiters = createSignupLimiters();

/** État du formulaire : le code d'erreur et ce qui a été tapé (sauf les mots de passe). */
export interface SignupState {
  error: SignupErrorCode | null;
  email: string;
  username: string;
}

/**
 * Crée un compte avec courriel, nom d'utilisateur et mot de passe, sans lien par courriel
 * (« Confirm email » désactivé dans Supabase, voir le README). Le nom d'utilisateur passe par
 * les métadonnées du compte ; le déclencheur `handle_new_user` le copie dans le profil et
 * refuse un nom déjà pris (migration 0020).
 */
export async function creerCompte(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const next = safeNextPath(formData.get("next")?.toString());
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const username = normalizeUsername(formData.get("username")?.toString() ?? "");
  const password = formData.get("password")?.toString() ?? "";
  const confirm = formData.get("confirm")?.toString() ?? "";
  const fail = (error: SignupErrorCode): SignupState => ({ error, email, username });

  const invalid = validateSignup({ email, username, password, confirm });
  if (invalid) return fail(invalid);
  if (!allowLoginAttempt(signupLimiters, clientIp(await headers()), email)) return fail("limite");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("config");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) {
    console.error("Inscription :", error.status, error.code, error.message);
    return fail(signUpErrorCode(error));
  }
  // « Confirm email » encore activé : Supabase ne crée pas de session et répond sans erreur,
  // même si le courriel est déjà utilisé (dans ce cas, `identities` est vide).
  if (!data.session) {
    if (data.user && data.user.identities?.length === 0) return fail("existe");
    redirect(`/connexion?${new URLSearchParams({ cree: "confirmer", next }).toString()}`);
  }
  const onboarded = await getOnboardingStatus(supabase);
  redirect(afterLoginPath(next, onboarded));
}
