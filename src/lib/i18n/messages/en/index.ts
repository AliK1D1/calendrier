import type { Messages } from "../fr";
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

/** English texts. Each area mirrors the French file of the same name. */
export const en: Messages = {
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
};
