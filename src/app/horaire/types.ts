import type { ActionResult } from "@/lib/actions";
import type { ConfirmResult, PreviewResult } from "@/lib/import/icsImport";
import type { QuietHours } from "@/lib/scheduling/quietHours";
import type { BlockSpec } from "@/lib/scheduling/weeklyBlocks";

/**
 * Bloc affiché par /horaire : `BlockSpec` enregistré + son origine. `meetup` : plan de groupe
 * accepté (segment 12), en lecture seule ici (on le refuse dans « Mes plans »).
 */
export type ScheduleBlock = BlockSpec & {
  id: string;
  source: "manual" | "ics" | "image" | "study" | "meetup";
};

export interface SchedulePlace {
  id: string;
  name: string;
}

/** Actions de l'éditeur (actions serveur dans l'app ; injectables pour les tests de rendu). */
export interface ScheduleActions {
  ajouterBlocs: (input: unknown) => Promise<ActionResult>;
  modifierBloc: (id: unknown, input: unknown) => Promise<ActionResult>;
  supprimerBloc: (id: unknown) => Promise<ActionResult>;
}

/** Actions de l'import .ics : aperçu (lecture seule) puis confirmation. */
export interface IcsActions {
  apercuIcs: (data: FormData) => Promise<PreviewResult>;
  confirmerIcs: (input: unknown) => Promise<ConfirmResult>;
}

export interface ScheduleEditorProps {
  blocks: ScheduleBlock[];
  places: SchedulePlace[];
  homeId: string | null;
  /** Heures où je ne sors pas (`null` : inconnues, migration 0004 absente). */
  quiet: QuietHours | null;
  /** Aujourd'hui, `yyyy-MM-dd` dans le fuseau America/Toronto (calculé par le serveur). */
  today: string;
  actions: ScheduleActions;
  icsActions: IcsActions;
  /** Noms des lieux des plans acceptés qui ne sont pas à moi (favori du groupe, lieu d'un ami). */
  extraPlaceNames?: Record<string, string>;
}
