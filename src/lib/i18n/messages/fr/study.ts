import { plural } from "@/lib/ux/plural";

/** Étude : page /etude et panneau des séances proposées (/horaire). */
export const study = {
  metaTitle: "Étude · Freecrew",
  title: "Étude",
  intro:
    "Entre tes examens et tes travaux : l'app propose des séances d'étude dans tes vrais moments libres, là où tu es déjà (au cégep entre deux cours, ou à la maison).",
  kinds: { exam: "Examen", assignment: "Travail" },
  difficulty: { 1: "Facile", 2: "Moyen", 3: "Difficile" },
  conflict: {
    title: (n: number): string =>
      n > 1 ? "Séances en conflit : replanifier ?" : "Séance en conflit : replanifier ?",
    body: (n: number) =>
      `Autre chose tombe maintenant sur ${n > 1 ? "ces séances d'étude déplaçables" : "cette séance d'étude déplaçable"} (un plan de groupe, un cours ou le trajet pour y aller) :`,
    replan: "Replanifier",
    computing: "Calcul…",
  },
  panel: {
    titlePlan: "Séances d'étude proposées",
    titleReplan: "Nouvelles places proposées",
    summary: (n: number, total: string) =>
      `${plural(n, "séance", "séances")}, ${total} en tout, en pointillé dans la grille. Rien n'est ajouté à ton horaire avant que tu acceptes. Glisse une séance dans la grille (ou utilise les flèches) pour la déplacer.`,
    none: "Aucune séance à proposer.",
    acceptAll: "Tout accepter",
    moveAll: "Tout déplacer",
    refuseAll: "Tout refuser",
    accept: "Accepter",
    move: "Déplacer",
    refuse: "Refuser",
    earlier: (what: string) => `${what} : 15 minutes plus tôt`,
    later: (what: string) => `${what} : 15 minutes plus tard`,
    show: (what: string) => `Voir ${what}, dans la grille`,
  },
  view: {
    planTitle: "Planifier mon étude",
    planDesc:
      "Les séances proposées s'affichent dans ton horaire, en pointillé. Rien n'est ajouté avant que tu acceptes ; tu peux les déplacer ou les refuser.",
    noHomeBefore: "Choisis d'abord ta maison dans ",
    noHomeLink: "Mes lieux",
    noHomeAfter: " : les séances ont lieu là où tu es déjà, ou chez toi.",
    addFirst: "Ajoute un examen ou un travail ci-dessous pour commencer.",
    prefsBefore: "Durée des séances, maximum par jour et heures d'étude : ",
    prefsLink: "préférences d'étude",
    addTitle: "Ajouter un examen ou un travail",
    added: (kind: string) =>
      `${kind} ajouté. Touche « Planifier mon étude » pour voir les séances.`,
    upcoming: "À venir",
    noUpcoming: "Aucun examen ni travail à venir.",
    past: (n: number) => `Passés (${n})`,
    toPlan: (d: string) => `${d} à prévoir`,
    yourEstimate: " (ton estimation)",
    inSchedule: (d: string) => `${d} dans ton horaire`,
    delete: "Supprimer",
    deleteLabel: (course: string) => `Supprimer ${course}`,
    deleteConfirm: (course: string, sessions: number) =>
      `Supprimer « ${course} » ?${sessions > 0 ? `\nSes ${plural(sessions, "séance", "séances")} d'étude seront retirées de ton horaire.` : ""}`,
    deleted: "Supprimé.",
    acceptedUpcoming: (n: number) =>
      plural(n, "séance acceptée à venir", "séances acceptées à venir"),
    movable: "Déplaçable",
    nowMovable: "Séance déplaçable.",
    nowFixed: "Séance fixe.",
    remove: "Retirer",
    removeLabel: (label: string) => `Retirer la séance du ${label}`,
    removed: "Séance retirée.",
  },
  form: {
    type: "Type",
    exam: "Examen",
    assignment: "Travail à remettre",
    course: "Cours",
    coursePlaceholder: "ex. Chimie générale",
    examDate: "Date de l'examen",
    dueDate: "Date de remise",
    time: "Heure",
    hours: "Heures d'étude estimées",
    hoursPlaceholder: "Je ne sais pas",
    hoursHelp: "Laisse vide si tu ne sais pas : on se fie à la difficulté.",
    difficulty: "Difficulté",
    saving: "Enregistrement…",
    add: "Ajouter",
  },
};
