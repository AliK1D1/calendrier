import type { onboarding as fr } from "../fr/onboarding";

export const onboarding: typeof fr = {
  metaTitle: "Welcome · Freecrew",
  title: "Welcome!",
  intro:
    "Three questions so the app can work out realistic trips. You can change everything later in “My places” and “Profile”.",
  steps: ["Your home", "Your college or school", "How you get around"],
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  stepHints: [
    "Where do you leave from in the morning and come back to at night?",
    "Where you spend your days. You can skip this step.",
    "We use it to estimate your travel times.",
  ],
  homeLabel: "Your home address",
  homePlaceholder: "E.g. 945 chemin de Chambly, Longueuil",
  homeDefaultName: "Home",
  schoolLabel: "Name or address of your college or school",
  schoolPlaceholder: "E.g. Cégep Édouard-Montpetit",
  adjustPoint: "tap the map to adjust the point.",
  displayName: "Display name",
  back: "Back",
  continue: "Continue",
  noSchool: "I don't have one",
  skipStep: "Skip this step",
  finish: "Finish",
  later: "Later (I'll do it in “My places”)",
  invite: {
    metaTitle: "Invitation · Freecrew",
    title: "Invitation",
    invalid: "Invalid invite link",
    checkFailed: "Can't check this link right now. Try again in a minute.",
    notFound:
      "This link doesn't exist or was replaced by the group admin. Ask them for a new link.",
    already: (name: string) => `You're already in “${name}”`,
    openGroup: "Open the group",
    join: (name: string) => `Join “${name}”?`,
    joinBody: (n: number) =>
      `${n} member${n > 1 ? "s" : ""}. When you join, members will see your name, your places and when you're busy (by default “Busy”, without your class titles).`,
    noThanks: "No thanks",
    joinButton: "Join the group",
    wait: "One moment…",
  },
};
