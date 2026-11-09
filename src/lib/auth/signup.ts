/**
 * Règles de création de compte (fonctions pures, testées) : nom d'utilisateur, mot de passe
 * et lecture des erreurs renvoyées par Supabase à l'inscription.
 */
import { isPlausibleEmail } from "./paths";

/** Longueurs du nom d'utilisateur (mêmes limites que la contrainte `profiles_username_format`). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Lettres minuscules, chiffres, « _ » et « . » ; commence par une lettre ou un chiffre. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.]{2,19}$/;

/** Mot de passe : au moins 8 caractères, une majuscule, une minuscule et un chiffre. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Nom d'utilisateur tel qu'enregistré : sans espaces autour, en minuscules. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Vrai si le nom (déjà normalisé) respecte le format. */
export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export type PasswordProblem = "court" | "long" | "majuscule" | "minuscule" | "chiffre";

/** Ce qui manque au mot de passe (liste vide : il est accepté). */
export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN) problems.push("court");
  if (password.length > PASSWORD_MAX) problems.push("long");
  if (!/\p{Lu}/u.test(password)) problems.push("majuscule");
  if (!/\p{Ll}/u.test(password)) problems.push("minuscule");
  if (!/\p{Nd}/u.test(password)) problems.push("chiffre");
  return problems;
}

/** Code d'erreur de /inscription (`?erreur=`), ou `null` si le formulaire est valide. */
export type SignupErrorCode =
  | "courriel"
  | "nom"
  | "motdepasse"
  | "confirmation"
  | "pris"
  | "existe"
  | "limite"
  | "echec"
  | "config";

export interface SignupInput {
  email: string;
  username: string;
  password: string;
  confirm: string;
}

/** Vérifie le formulaire (courriel et nom déjà normalisés). */
export function validateSignup(input: SignupInput): SignupErrorCode | null {
  if (!isPlausibleEmail(input.email)) return "courriel";
  if (!isValidUsername(input.username)) return "nom";
  if (passwordProblems(input.password).length > 0) return "motdepasse";
  if (input.password !== input.confirm) return "confirmation";
  return null;
}

/**
 * Code d'erreur pour un échec de `supabase.auth.signUp`. Un nom d'utilisateur déjà pris au
 * dernier moment fait échouer le déclencheur `handle_new_user` (index unique) : Supabase
 * répond alors « Database error saving new user ».
 */
export function signUpErrorCode(error: {
  code?: string;
  status?: number;
  message?: string;
}): SignupErrorCode {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.status === 429 || text.includes("rate limit") || text.includes("rate_limit")) {
    return "limite";
  }
  if (text.includes("user_already_exists") || text.includes("already registered")) {
    return "existe";
  }
  if (text.includes("weak_password") || text.includes("password should")) return "motdepasse";
  if (text.includes("database error saving new user")) return "pris";
  return "echec";
}
