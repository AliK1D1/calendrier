import { auth } from "./auth";
import { common } from "./common";
import { study } from "./study";
import { schedule } from "./schedule";
import { meetups } from "./meetups";
import { plans } from "./plans";
import { groups } from "./groups";
import { places } from "./places";
import { onboarding } from "./onboarding";
import { home } from "./home";
import { profile } from "./profile";

/** Textes en français (Québec), la langue par défaut. Chaque domaine a son fichier. */
export const fr = {
  auth,
  common,
  study,
  schedule,
  meetups,
  plans,
  groups,
  places,
  onboarding,
  home,
  profile,
};

export type Messages = typeof fr;
