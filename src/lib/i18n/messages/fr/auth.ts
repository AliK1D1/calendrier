/** Pages de connexion et de création de compte. */
export const auth = {
  metaTitle: "Connexion · Freecrew",
  title: "Connexion",
  description: "Connecte-toi avec ton courriel et ton mot de passe.",
  email: "Adresse courriel",
  emailPlaceholder: "toi@exemple.ca",
  or: "ou",
  google: "Continuer avec Google",
  password: "Mot de passe",
  signIn: "Se connecter",
  noAccount: "Pas encore de compte ?",
  createAccount: "Créer un compte",
  created: "Compte créé ! Tu peux maintenant te connecter.",
  createdConfirm:
    "Compte créé, mais Supabase demande encore une confirmation par courriel : l'administrateur de l'app doit désactiver « Confirm email » (voir le README).",
  errors: {
    config:
      "La connexion n'est pas encore configurée (variables Supabase manquantes). Voir le README.",
    lien: "La connexion n'a pas abouti. Réessaie.",
    courriel: "Adresse courriel invalide.",
    limite: "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.",
    motdepasse: "Courriel ou mot de passe incorrect.",
    essais: "Trop d'essais de mot de passe. Attends 15 minutes avant de réessayer.",
    confirmer:
      "Ce compte n'est pas encore confirmé. Demande à l'administrateur de l'app de le confirmer.",
    echec: "La connexion n'a pas abouti. Réessaie.",
    google: "La connexion avec Google n'a pas fonctionné. Réessaie ou utilise ton courriel.",
  } as Record<string, string>,
  signup: {
    metaTitle: "Créer un compte · Freecrew",
    title: "Créer un compte",
    description: "Choisis un nom d'utilisateur et un mot de passe. Aucun courriel à ouvrir.",
    username: "Nom d'utilisateur",
    usernameHint: "3 à 20 caractères : lettres minuscules, chiffres, « _ » ou « . ».",
    password: "Mot de passe",
    passwordHint: "Au moins 8 caractères, avec une majuscule, une minuscule et un chiffre.",
    confirm: "Confirmer le mot de passe",
    submit: "Créer mon compte",
    haveAccount: "Déjà un compte ?",
    signIn: "Se connecter",
    rules: {
      court: "8 caractères minimum",
      majuscule: "une majuscule",
      minuscule: "une minuscule",
      chiffre: "un chiffre",
      pareil: "les deux mots de passe sont identiques",
    },
    errors: {
      config:
        "La création de compte n'est pas encore configurée (variables Supabase manquantes). Voir le README.",
      courriel: "Adresse courriel invalide.",
      nom: "Nom d'utilisateur invalide : 3 à 20 caractères, lettres minuscules, chiffres, « _ » ou « . », sans commencer par « _ » ou « . ».",
      motdepasse:
        "Mot de passe trop faible : au moins 8 caractères, avec une majuscule, une minuscule et un chiffre.",
      confirmation: "Les deux mots de passe ne sont pas identiques.",
      pris: "Ce nom d'utilisateur est déjà pris. Choisis-en un autre.",
      existe: "Un compte existe déjà avec ce courriel. Connecte-toi plutôt.",
      limite: "Trop de comptes créés en peu de temps. Réessaie dans une heure.",
      echec: "La création du compte n'a pas abouti. Réessaie.",
    } as Record<string, string>,
  },
};
