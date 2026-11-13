/**
 * Grille des disponibilités d'un groupe (vue « grille » de « Quand on peut se voir ») :
 * pour chaque jour et chaque tranche (ex. 30 min), qui est libre. Une personne est libre dans
 * une tranche si une de ses fenêtres libres la couvre entièrement. Les trajets ne comptent
 * pas ici : c'est une vue d'ensemble, les propositions réalistes viennent de `findMeetups`.
 * Fonction pure.
 */
import { getFreeWindows } from "./freeWindows";
import { DEFAULT_DAY_HOURS } from "./findMeetups";
import { addMinutesTo, eachDay, zonedDayBounds, zonedTime } from "./time";
import type { DateRange, DayHours, Person, PersonId } from "./types";

/** Une tranche de la grille. */
export interface GridSlot {
  start: Date;
  end: Date;
  /** Personnes libres pendant toute la tranche, dans l'ordre des participants. */
  freeIds: PersonId[];
}

/** Une journée de la grille. */
export interface GridDay {
  day: string;
  slots: GridSlot[];
}

export interface AvailabilityGridOptions {
  dayHours?: DayHours;
  /** Durée d'une tranche, en minutes (défaut 30). */
  stepMinutes?: number;
}

export function availabilityGrid(
  people: readonly Person[],
  range: DateRange,
  options: AvailabilityGridOptions = {},
): GridDay[] {
  const { dayHours = DEFAULT_DAY_HOURS, stepMinutes = 30 } = options;
  if (!Number.isInteger(stepMinutes) || stepMinutes < 5) {
    throw new Error("La tranche de la grille doit être d'au moins 5 minutes.");
  }
  return eachDay(range.from, range.to).map((day) => {
    const { start: dayStart, end: dayEnd } = zonedDayBounds(day);
    const windows = people.map((p) => getFreeWindows(p, dayStart, dayEnd, { dayHours }));
    const first = zonedTime(day, dayHours.start);
    const last = zonedTime(day, dayHours.end);
    const slots: GridSlot[] = [];
    for (let s = first; s.getTime() < last.getTime(); s = addMinutesTo(s, stepMinutes)) {
      const e = new Date(Math.min(addMinutesTo(s, stepMinutes).getTime(), last.getTime()));
      const freeIds = people
        .filter((_, k) =>
          windows[k].some(
            (w) => w.start.getTime() <= s.getTime() && w.end.getTime() >= e.getTime(),
          ),
        )
        .map((p) => p.id);
      slots.push({ start: s, end: e, freeIds });
    }
    return { day, slots };
  });
}
