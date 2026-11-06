/** Page de connexion. */
export const auth = {
  metaTitle: "Connexion · Temps libre commun",
  title: "Connexion",
  description:
    "Le plus simple : on t'envoie un lien de connexion par courriel. Pas encore de compte ? Il est créé automatiquement.",
  sentBefore: "Lien envoyé ! Ouvre le courriel ",
  sentStrong: "dans ce même navigateur",
  sentAfter: " pour te connecter. Pense à regarder dans les indésirables.",
  email: "Adresse courriel",
  emailPlaceholder: "toi@exemple.ca",
  sendLink: "Recevoir un lien de connexion",
  or: "ou",
  google: "Continuer avec Google",
  withPassword: "Se connecter avec un mot de passe",
  password: "Mot de passe",
  signIn: "Se connecter",
  errors: {
    config:
      "La connexion n'est pas encore configurée (variables Supabase manquantes). Voir le README.",
    lien: "Ce lien de connexion est invalide ou expiré. Demande un nouveau lien.",
    courriel: "Adresse courriel invalide.",
    envoi: "Impossible d'envoyer le lien pour l'instant. Réessaie dans une minute.",
    limite:
      "Trop de liens envoyés récemment (limite du service de courriel). Réessaie dans une heure, ou utilise le dernier lien reçu.",
    motdepasse: "Courriel ou mot de passe incorrect.",
    essais: "Trop d'essais de mot de passe. Attends 15 minutes, ou utilise le lien par courriel.",
    echec: "La connexion n'a pas abouti. Réessaie.",
    google: "La connexion avec Google n'a pas fonctionné. Réessaie ou utilise ton courriel.",
  } as Record<string, string>,
};
