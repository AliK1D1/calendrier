/** Page Profil et ses formulaires. */
export const profile = {
  metaTitle: "Profil",
  title: "Profil",
  dbOutdated: (migration: string) =>
    `La base de données n'est pas à jour : applique supabase/migration-${migration}.sql (voir README).`,
  sections: {
    you: "Toi",
    quiet: "Heures où je ne sors pas",
    privacy: "Confidentialité",
    outlook: "Outlook",
    subscriptions: "Calendriers en ligne",
    study: "Étude",
    appearance: "Apparence",
    home: "Maison et déconnexion",
  },
  you: {
    title: "Toi",
    description: (email: string) =>
      `Ton mode de transport sert à estimer tes temps de trajet. Connecté en tant que ${email}.`,
    fallbackUser: "utilisateur",
    name: "Ton nom (vu par tes amis)",
    saved: "Profil enregistré.",
  },
  quiet: {
    title: "Heures où je ne sors pas",
    description:
      "L'app ne te proposera rien en dehors de ces heures : elles comptent comme du temps occupé à la maison, tous les jours.",
    before: "Je ne sors pas avant",
    after: "Je ne sors pas après",
    noLimit: "Pas de limite",
    saved: "Heures enregistrées.",
    save: "Enregistrer ces heures",
  },
  privacy: {
    title: "Confidentialité",
    description:
      "Ce que les membres de tes groupes voient de ton horaire. Ton nom et tes lieux restent visibles pour qu'on puisse calculer les trajets.",
    hideTitles:
      "Masquer le titre de mes blocs : les membres de mes groupes voient seulement « Occupé », l'heure et le lieu.",
    saved: "Réglage enregistré.",
  },
  study: {
    title: "Préférences d'étude",
    description:
      "Pour les séances que l'app te propose avant un examen ou un travail (page Étude). Les séances ont lieu dans ces heures, et jamais pendant tes heures où tu ne sors pas.",
    minSession: "Séance d'au moins",
    maxSession: "Séance d'au plus",
    maxPerDay: "Au plus par jour",
    breakBetween: "Pause entre deux séances",
    noBreak: "Aucune",
    from: "J'étudie à partir de",
    until: "Et jusqu'à",
    eve: "La veille d'un examen, pas après",
    noLimit: "Pas de limite",
    keepFree: "Soirées et fins de semaine : garder libre",
    keepFreeNone: "Rien de spécial",
    keepFreeAtLeast: (p: number) => `Au moins ${p} %`,
    saved: "Préférences enregistrées.",
    save: "Enregistrer ces préférences",
  },
  appearance: {
    title: "Apparence",
    description:
      "Mode clair ou sombre, et la couleur des boutons. Le changement se voit tout de suite.",
    theme: "Thème",
    themes: { systeme: "Selon l'appareil", clair: "Clair", sombre: "Sombre" },
    themeHint:
      "« Selon l'appareil » passe en sombre en même temps que ton téléphone ou ton ordinateur.",
    accent: "Couleur d'accent",
    accents: {
      bleu: "Bleu",
      indigo: "Indigo",
      rose: "Rose",
      orange: "Orange",
      vert: "Vert",
      sarcelle: "Sarcelle",
      graphite: "Graphite",
    },
    accentHint:
      "Pour les boutons, les liens actifs et le contour de sélection. Les couleurs des jours et des blocs de l'horaire ne changent pas.",
    deviceOnly:
      "Enregistré sur cet appareil seulement : ton téléphone et ton ordinateur peuvent avoir des réglages différents.",
  },
  home: {
    title: "Maison",
    yourHome: (name: string) => `Ta maison : ${name}.`,
    noHome: "Tu n'as pas encore choisi ta maison.",
    managePlaces: "Gérer mes lieux",
    signOut: "Se déconnecter",
  },
  outlook: {
    title: "Calendrier Outlook",
    description:
      "Connecte ton calendrier Outlook (compte personnel ou de travail/école) : tes événements comptent comme du temps occupé, sans les entrer à la main. Lecture seule : l'app n'écrit jamais dans ton Outlook. Tes amis voient seulement « Occupé », jamais les titres ni les lieux.",
    intro:
      "On lit ton calendrier principal (tu pourras en choisir un autre), de cette semaine jusqu'à 8 semaines plus tard. La synchro se fait aux 15 minutes quand tu as l'app ouverte, et quand tu cliques sur « Actualiser ».",
    connect: "Connecter Outlook",
    notConfigured: "Outlook n'est pas encore configuré sur ce site (clés Microsoft manquantes).",
    account: "Compte",
    microsoftAccount: "Compte Microsoft",
    calendar: "Calendrier",
    mainCalendar: "Calendrier principal",
    lastSync: "Dernière synchro",
    notYet: "pas encore",
    calendarToRead: "Calendrier à lire",
    mainSuffix: " (principal)",
    choose: "Choisir",
    chosen: "Calendrier choisi.",
    synced: "Outlook synchronisé.",
    oneMoment: "Un instant…",
    refreshNow: "Actualiser maintenant",
    chooseCalendar: "Choisir le calendrier",
    reconnect: "Reconnecter Outlook",
    confirmDisconnect:
      "Déconnecter Outlook ? Tes blocs Outlook seront supprimés de l'app tout de suite.",
    disconnect: "Déconnecter",
    disconnected: "Outlook déconnecté : ses blocs sont supprimés.",
    returns: {
      connecte: "Outlook connecté et synchronisé.",
      "connecte-erreur":
        "Outlook est connecté, mais la première synchro n'a pas fonctionné (voir ci-dessus).",
      refuse: "Connexion à Outlook annulée.",
      expire: "La connexion à Outlook a expiré. Recommence.",
      echec: "La connexion à Outlook n'a pas fonctionné. Réessaie.",
      "non-configure": "Outlook n'est pas encore configuré sur ce site.",
    } as Record<string, string>,
  },
  subscriptions: {
    title: "Calendriers en ligne",
    description:
      "Abonne-toi à un calendrier qui se met à jour tout seul (horaire de la Formule 1, de ton équipe, fêtes…), avec ou sans Outlook. Tu choisis s'il compte comme du temps occupé. Personne d'autre ne voit tes calendriers abonnés.",
    busyQuestion: "Ces événements comptent-ils comme du temps occupé ?",
    busyYes: "Oui, je suis occupé",
    busyYesHint: " : l'app ne propose rien à ces heures (tes amis voient « Occupé »).",
    busyNo: "Non, juste pour voir",
    busyNoHint:
      " : affichés dans mon horaire, sans bloquer mon temps libre (ex. les courses de F1). Personne d'autre ne les voit.",
    done: "C'est fait.",
    justToSee: "juste pour voir",
    lastUpdate: (when: string) => `Dernière mise à jour : ${when}`,
    notYet: "pas encore",
    keepLast: (when: string | null) =>
      ` On garde la dernière version connue${when ? ` (${when})` : ""}. Si le lien ne marche plus, retire ce calendrier.`,
    countsAsBusy: "Compte comme du temps occupé",
    refresh: "Actualiser",
    confirmRemove: (name: string) =>
      `Retirer « ${name} » ? Ses événements ne seront plus affichés ni utilisés.`,
    remove: "Retirer",
    full: (max: number) =>
      `Tu as atteint ${max} calendriers abonnés : retires-en un pour en ajouter un autre.`,
    chooseBusy: "Choisis si ce calendrier compte comme du temps occupé.",
    addByLink: "Ajouter par un lien",
    link: "Lien du calendrier (.ics ou webcal://)",
    linkPlaceholder: "webcal://exemple.com/calendrier.ics",
    linkHint:
      "Sur le site du calendrier, cherche « S'abonner », « iCal » ou « Ajouter à Outlook / Google », puis copie le lien. Attention : un lien secret (ex. « adresse secrète iCal » de Google) donne accès à tout ce calendrier ; ne le partage avec personne d'autre.",
    name: "Nom (facultatif)",
    namePlaceholder: "Ex. Formule 1",
    oneMoment: "Un instant…",
    add: "Ajouter le calendrier",
    fromOutlook: "Depuis ton compte Outlook",
    fromOutlookHint:
      "Les calendriers auxquels tu es abonné dans Outlook (et tes autres calendriers) apparaissent ici. Les titres des événements ne sont pas lus : ils portent le nom du calendrier.",
    noOtherOutlook: "Aucun autre calendrier dans ton compte Outlook.",
    seeOutlook: "Voir mes calendriers Outlook",
    outlookCalendar: "Calendrier Outlook",
    subscribedSuffix: " (abonné)",
    addShort: "Ajouter",
    footer:
      "On lit 8 semaines à partir de cette semaine. Mise à jour automatique aux 6 heures quand tu as l'app ouverte, ou avec « Actualiser ». Si un lien ne répond plus, on garde la dernière version et on t'avertit ici.",
  },
};
