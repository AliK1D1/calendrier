/** Accueil (visiteur et personne connectée). */
export const home = {
  intro:
    "Des moments et des endroits où se voir qui sont vraiment réalistes : trajet, durée minimale et lieu de chacun compris.",
  signIn: "Se connecter",
  howItWorks: "Comment ça marche",
  pitch: [
    {
      title: "Entre ton horaire",
      text: "Tes cours, ton travail et tes lieux habituels (cégep, maison, job).",
    },
    { title: "Invite tes amis", text: "Crée un groupe et partage le lien d'invitation." },
    {
      title: "Vois-vous pour vrai",
      text: "L'app propose des moments et des endroits faisables, en tenant compte du temps de trajet de chacun.",
    },
  ],
  createAccount: "Créer un compte",
  // Exemple illustré de l'accueil : trois horaires d'un jeudi et le moment libre en commun.
  demo: {
    label:
      "Exemple : les horaires de trois amis un jeudi, et le moment où ils sont libres en même temps.",
    day: "Jeudi",
    people: [
      { name: "Toi", blocks: ["Maths", "Chimie", "Philo", "Job"] },
      { name: "Maya", blocks: ["Labo", "Français", "Gym"] },
      { name: "Sam", blocks: ["Anglais", "Maths", "Job"] },
    ],
    free: "Libres tous les trois",
    place: "Café près du cégep",
    travel: "Trajets compris : 12 min pour toi, 20 min pour Maya, 8 min pour Sam.",
  },
  hello: (name?: string) => (name ? `Salut ${name} !` : "Salut !"),
  ready: "Tout est prêt. Choisis un groupe pour trouver un moment réaliste.",
  progress: (done: number) =>
    `Pour trouver des moments avec tes amis : ${done} étape${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} sur 4.`,
  findMoment: "Trouver un moment",
  gettingStarted: "Pour commencer",
  stepDone: " (fait)",
  stepTodo: " (à faire)",
  steps: {
    maison: { title: "Ta maison", hint: "Le point de départ de tes trajets." },
    horaire: {
      title: "Ton horaire",
      hint: "Tes cours et ton travail : à la main, par fichier, ou en connectant ton calendrier.",
    },
    groupe: { title: "Un groupe", hint: "Crée un groupe, ou ouvre le lien qu'un ami t'a envoyé." },
    ami: { title: "Un ami dans ton groupe", hint: "Envoie-lui le lien d'invitation du groupe." },
    moment: { title: "Trouver un moment", hint: "Possible dès que vous êtes deux dans un groupe." },
  },
  momentHint: (group: string) => `Cherche quand vous pouvez vous voir dans « ${group} ».`,
  myGroups: "Mes groupes",
  groupMembers: (n: number) => `${n} membre${n >= 2 ? "s" : ""} · trouver un moment`,
  groupAlone: "Seul·e pour l'instant · inviter des amis",
  signedInAs: "Connecté en tant que",
  user: "utilisateur",
  signOut: "Se déconnecter",
  plans: {
    awaiting: (n: number) =>
      n > 1 ? `${n} plans attendent ta réponse` : "Un plan attend ta réponse",
    awaitingHint: "Si tu acceptes, le moment s'ajoute à ton horaire.",
    upcoming: "Tes prochains plans",
    seeAll: (more: number) =>
      more > 0
        ? `Voir tous mes plans (${more} autre${more >= 2 ? "s" : ""})`
        : "Voir tous mes plans",
  },
};
