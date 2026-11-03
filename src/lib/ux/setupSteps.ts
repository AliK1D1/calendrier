/**
 * Étapes de démarrage montrées sur l'accueil d'une personne connectée : ce qui est fait,
 * et la prochaine chose à faire pour arriver à « trouver un moment avec mes amis ».
 * Fonction pure (les comptes viennent de la page).
 */

export interface SetupInput {
  /** L'accueil de première connexion (/bienvenue) est fait ou passé. `null` : inconnu. */
  onboarded: boolean | null;
  hasHome: boolean;
  blockCount: number;
  groups: { id: string; name: string; memberCount: number }[];
}

export type SetupStepId = "maison" | "horaire" | "groupe" | "ami" | "moment";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  hint: string;
  href: string;
  done: boolean;
}

export interface SetupPlan {
  steps: SetupStep[];
  /** Première étape pas faite (celle à mettre en avant), `null` si tout est fait. */
  next: SetupStep | null;
  doneCount: number;
}

export function setupSteps(input: SetupInput): SetupPlan {
  // Le groupe où l'on peut chercher un moment : le plus gros (au moins 2 membres).
  const withFriends = [...input.groups]
    .filter((g) => g.memberCount >= 2)
    .sort((a, b) => b.memberCount - a.memberCount)[0];
  const firstGroup = input.groups[0];

  const steps: SetupStep[] = [
    {
      id: "maison",
      title: "Ta maison",
      hint: "Le point de départ de tes trajets.",
      href: input.onboarded === false ? "/bienvenue" : "/lieux",
      done: input.hasHome,
    },
    {
      id: "horaire",
      title: "Ton horaire",
      hint: "Tes cours et ton travail (à la main ou par fichier .ics).",
      href: "/horaire",
      done: input.blockCount > 0,
    },
    {
      id: "groupe",
      title: "Un groupe",
      hint: "Crée un groupe, ou ouvre le lien qu'un ami t'a envoyé.",
      href: "/groupes",
      done: input.groups.length > 0,
    },
    {
      id: "ami",
      title: "Un ami dans ton groupe",
      hint: "Envoie-lui le lien d'invitation du groupe.",
      href: firstGroup ? `/groupes/${firstGroup.id}#inviter` : "/groupes",
      done: withFriends !== undefined,
    },
    {
      id: "moment",
      title: "Trouver un moment",
      hint: withFriends
        ? `Cherche quand vous pouvez vous voir dans « ${withFriends.name} ».`
        : "Possible dès que vous êtes deux dans un groupe.",
      href: withFriends ? `/groupes/${withFriends.id}#se-voir` : "/groupes",
      // Jamais « fait » : c'est l'action que l'accueil propose une fois le reste prêt.
      done: false,
    },
  ];

  const next = steps.find((s) => !s.done) ?? null;
  return { steps, next, doneCount: steps.filter((s) => s.done).length };
}
