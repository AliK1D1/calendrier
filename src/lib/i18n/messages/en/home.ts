import type { home as fr } from "../fr/home";

export const home: typeof fr = {
  intro:
    "Times and places to meet that are actually realistic: everyone's travel, minimum duration and location included.",
  signIn: "Sign in",
  howItWorks: "How it works",
  pitch: [
    {
      title: "Enter your schedule",
      text: "Your classes, your job and the places you usually are (college, home, work).",
    },
    { title: "Invite your friends", text: "Create a group and share the invite link." },
    {
      title: "Actually see each other",
      text: "The app suggests doable times and places, taking everyone's travel time into account.",
    },
  ],
  hello: (name?: string) => (name ? `Hi ${name}!` : "Hi!"),
  ready: "You're all set. Pick a group to find a realistic time.",
  progress: (done: number) => `To find times with your friends: ${done} of 4 steps done.`,
  findMoment: "Find a time",
  gettingStarted: "Getting started",
  stepDone: " (done)",
  stepTodo: " (to do)",
  steps: {
    maison: { title: "Your home", hint: "Where your trips start from." },
    horaire: {
      title: "Your schedule",
      hint: "Your classes and job: by hand, from a file, or by connecting your calendar.",
    },
    groupe: { title: "A group", hint: "Create a group, or open the link a friend sent you." },
    ami: { title: "A friend in your group", hint: "Send them the group's invite link." },
    moment: { title: "Find a time", hint: "Available as soon as there are two of you in a group." },
  },
  momentHint: (group: string) => `See when you can meet in “${group}”.`,
  myGroups: "My groups",
  groupMembers: (n: number) => `${n} member${n >= 2 ? "s" : ""} · find a time`,
  groupAlone: "Just you for now · invite friends",
  signedInAs: "Signed in as",
  user: "user",
  signOut: "Sign out",
  plans: {
    awaiting: (n: number) =>
      n > 1 ? `${n} plans are waiting for your answer` : "A plan is waiting for your answer",
    awaitingHint: "If you accept, the time is added to your schedule.",
    upcoming: "Your next plans",
    seeAll: (more: number) => (more > 0 ? `See all my plans (${more} more)` : "See all my plans"),
  },
};
