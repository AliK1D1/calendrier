import type { auth as fr } from "../fr/auth";

export const auth: typeof fr = {
  metaTitle: "Sign in · Common Free Time",
  title: "Sign in",
  description:
    "The easiest way: we email you a sign-in link. No account yet? One is created automatically.",
  sentBefore: "Link sent! Open the email ",
  sentStrong: "in this same browser",
  sentAfter: " to sign in. Remember to check your spam folder.",
  email: "Email address",
  emailPlaceholder: "you@example.ca",
  sendLink: "Get a sign-in link",
  or: "or",
  google: "Continue with Google",
  withPassword: "Sign in with a password",
  password: "Password",
  signIn: "Sign in",
  errors: {
    config: "Sign-in isn't configured yet (missing Supabase variables). See the README.",
    lien: "This sign-in link is invalid or expired. Ask for a new link.",
    courriel: "Invalid email address.",
    envoi: "Can't send the link right now. Try again in a minute.",
    limite:
      "Too many links sent recently (email service limit). Try again in an hour, or use the last link you received.",
    motdepasse: "Wrong email or password.",
    essais: "Too many password attempts. Wait 15 minutes, or use the email link.",
    echec: "Sign-in didn't go through. Please try again.",
    google: "Signing in with Google didn't work. Try again or use your email.",
  },
};
