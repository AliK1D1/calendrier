/** Accueil de première connexion (/bienvenue) et page d'invitation (/rejoindre). */
export const onboarding = {
  metaTitle: "Bienvenue · Temps libre commun",
  title: "Bienvenue !",
  intro:
    "Trois questions pour que l'app calcule des trajets réalistes. Tu pourras tout changer plus tard dans « Mes lieux » et « Profil ».",
  steps: ["Ta maison", "Ton cégep ou ton école", "Ton mode de transport"],
  stepOf: (n: number, total: number) => `Étape ${n} sur ${total}`,
  stepHints: [
    "D'où pars-tu le matin et où reviens-tu le soir ?",
    "Là où tu passes tes journées. Tu peux passer cette étape.",
    "On s'en sert pour estimer tes temps de trajet.",
  ],
  homeLabel: "Adresse de ta maison",
  homePlaceholder: "Ex. 945 chemin de Chambly, Longueuil",
  homeDefaultName: "Maison",
  schoolLabel: "Nom ou adresse de ton cégep ou école",
  schoolPlaceholder: "Ex. Cégep Édouard-Montpetit",
  adjustPoint: "touche la carte pour ajuster le point.",
  displayName: "Nom affiché",
  back: "Retour",
  continue: "Continuer",
  noSchool: "Je n'en ai pas",
  skipStep: "Passer cette étape",
  finish: "Terminer",
  later: "Plus tard (je le ferai dans « Mes lieux »)",
  invite: {
    metaTitle: "Invitation · Temps libre commun",
    title: "Invitation",
    invalid: "Lien d'invitation invalide",
    checkFailed: "Impossible de vérifier ce lien pour l'instant. Réessaie dans une minute.",
    notFound:
      "Ce lien n'existe pas ou a été remplacé par l'admin du groupe. Demande-lui un nouveau lien.",
    already: (name: string) => `Tu fais déjà partie de « ${name} »`,
    openGroup: "Ouvrir le groupe",
    join: (name: string) => `Rejoindre « ${name} » ?`,
    joinBody: (n: number) =>
      `${n} membre${n > 1 ? "s" : ""}. En rejoignant, les membres verront ton nom, tes lieux et quand tu es occupé (par défaut « Occupé », sans le titre de tes cours).`,
    noThanks: "Non merci",
    joinButton: "Rejoindre le groupe",
    wait: "Un instant…",
  },
};
