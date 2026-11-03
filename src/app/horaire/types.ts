import type { ActionResult } from "@/lib/actions";
import type { ConfirmResult, PreviewResult } from "@/lib/import/icsImport";
import type { Result } from "@/lib/places/validation";
import type { AcceptResult, ConflictView, SessionView, StudyPlanView } from "@/lib/study/service";
import type { QuietHours } from "@/lib/scheduling/quietHours";
import type { BlockSpec } from "@/lib/scheduling/weeklyBlocks";

/**
 * Bloc affiché par /horaire : `BlockSpec` enregistré + son origine. `meetup` : plan de groupe
 * accepté (segment 12), en lecture seule ici (on le refuse dans « Mes plans »).
 */
export type ScheduleBlock = BlockSpec & {
  id: string;
  source: "manual" | "ics" | "image" | "study" | "meetup";
  /** Séance d'étude acceptée (segment 14) : déplaçable ou non. */
  movable?: boolean;
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

/** Actions du planificateur d'étude (actions serveur de /etude ; injectables pour une démo). */
export interface StudyActions {
  planifierEtude: () => Promise<Result<StudyPlanView>>;
  replanifierConflits: () => Promise<Result<StudyPlanView>>;
  verifierSeance: (input: unknown) => Promise<Result<SessionView>>;
  accepterSeances: (input: unknown) => Promise<AcceptResult>;
}

/** Planificateur d'étude dans /horaire. */
export interface StudyProps {
  /** Calcul à lancer à l'ouverture (`/horaire?etude=planifier` ou `?etude=replanifier`). */
  start: "planifier" | "replanifier" | null;
  /** Séances acceptées et déplaçables en conflit. */
  conflicts: ConflictView[];
  actions: StudyActions;
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
  /** Planificateur d'étude (absent : pas de séances proposées). */
  study?: StudyProps;
}
