/**
 * Planificateur d'étude (segment 14) : lecture des données de la personne connectée par un
 * magasin injecté (Supabase dans l'app, PGlite dans les tests), conversion, appel à la logique
 * pure (`studyPlanner.ts`) et mise en forme pour l'interface. Aucun accès BD direct ici.
 *
 * Le magasin lit **au nom de la personne connectée** (son jeton : RLS), jamais avec une clé
 * service. Les séances proposées ne sont jamais écrites : `prepareAcceptance` revalide chaque
 * séance (déplacée ou non) et renvoie les lignes à écrire, que l'action serveur écrit.
 */
import { formatInTimeZone } from "date-fns-tz";

import {
  type BusyBlockInput,
  type DeadlineInput,
  type PlaceInput,
  type ProfileInput,
  type StudyBlockInput,
  type StudyBlockRow,
  type StudyPreferencesInput,
  studySessionTitle,
  studySessionToRow,
  toAcceptedSession,
  toDeadline,
  toPeople,
  toStudyPreferences,
} from "@/lib/db/convert";
import type { Result } from "@/lib/places/validation";
import { localDay } from "@/lib/scheduling/period";
import {
  type AcceptedStudySession,
  checkStudySession,
  findStudyConflicts,
  planStudySessions,
  rescheduleStudySessions,
} from "@/lib/scheduling/studyPlanner";
import { minutesBetween, TIME_ZONE } from "@/lib/scheduling/time";
import { prefetchRequestsFor, type TravelTimeProvider } from "@/lib/scheduling/travel";
import type { Deadline, Person, StudyPreferences, StudySession } from "@/lib/scheduling/types";
import { shiftDay } from "@/lib/scheduling/weeklyBlocks";
import type { Locale } from "@/lib/i18n/config";
import { formatClockLocale, formatInstantDay } from "@/lib/i18n/format";

import type { SessionInput } from "./validation";

/**
 * On ne planifie que les échéances des 60 prochains jours (les séances commencent au plus
 * 14 jours avant) : l'horaire n'est déplié que sur cette période, ce qui borne le calcul.
 */
export const STUDY_HORIZON_DAYS = 60;

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Lectures nécessaires, au nom de la personne connectée (RLS). */
export interface StudyStore {
  /** Mon profil (mode de transport, maison, heures où je ne sors pas). */
  profile(): Promise<StoreResult<ProfileInput | null>>;
  /** Mes lieux personnels. */
  places(): Promise<StoreResult<PlaceInput[]>>;
  /** Lieux visibles par ces identifiants (lieux des plans de groupe acceptés). */
  placesByIds(ids: string[]): Promise<StoreResult<PlaceInput[]>>;
  /** Tous mes blocs, avec origine, échéance et « déplaçable ». */
  blocks(): Promise<StoreResult<StudyBlockInput[]>>;
  /** Mes échéances. */
  deadlines(): Promise<StoreResult<DeadlineInput[]>>;
  /** Mes préférences d'étude (`null` : jamais réglées). */
  preferences(): Promise<StoreResult<StudyPreferencesInput | null>>;
}

/** Magasin qui ne lit chaque chose qu'une fois (plusieurs calculs sur la même page). */
export function memoStudyStore(store: StudyStore): StudyStore {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let p = cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      cache.set(key, p);
    }
    return p;
  };
  return {
    profile: () => once("profile", () => store.profile()),
    places: () => once("places", () => store.places()),
    placesByIds: (ids) =>
      once(`placesByIds:${[...ids].sort().join(",")}`, () => store.placesByIds(ids)),
    blocks: () => once("blocks", () => store.blocks()),
    deadlines: () => once("deadlines", () => store.deadlines()),
    preferences: () => once("preferences", () => store.preferences()),
  };
}

export interface StudyDeps {
  userId: string;
  now: Date;
  travel: TravelTimeProvider;
  /** Langue des libellés (français par défaut). */
  locale?: Locale;
}

/** Données chargées et converties. */
export interface LoadedStudy {
  person: Person;
  deadlines: Deadline[];
  prefs: StudyPreferences;
  accepted: AcceptedStudySession[];
  ownPlaceIds: string[];
  placeNames: Map<string, string>;
}

const NO_HOME = "Choisis ta maison dans « Mes lieux » avant de planifier ton étude.";

/** Lit et convertit tout ce qu'il faut (horaire déplié d'aujourd'hui à `horizon` jours). */
export async function loadStudy(
  store: StudyStore,
  deps: StudyDeps,
  horizonDays: number = STUDY_HORIZON_DAYS,
): Promise<Result<LoadedStudy>> {
  const [profile, places, blocks, deadlines, prefs] = await Promise.all([
    store.profile(),
    store.places(),
    store.blocks(),
    store.deadlines(),
    store.preferences(),
  ]);
  if (!profile.ok) return profile;
  if (!places.ok) return places;
  if (!blocks.ok) return blocks;
  if (!deadlines.ok) return deadlines;
  if (!prefs.ok) return prefs;
  if (!profile.value || profile.value.id !== deps.userId) {
    return { ok: false, error: "Profil introuvable." };
  }
  // Défense en profondeur : seulement mes lignes.
  const ownPlaces = places.value.filter((p) => p.owner_id === deps.userId);
  const myBlocks = blocks.value.filter((b) => b.owner_id === deps.userId);
  const ownIds = new Set(ownPlaces.map((p) => p.id));
  const otherIds = [
    ...new Set(
      myBlocks
        .filter((b) => b.place_id && !ownIds.has(b.place_id))
        .map((b) => b.place_id as string),
    ),
  ];
  let others: PlaceInput[] = [];
  if (otherIds.length > 0) {
    const r = await store.placesByIds(otherIds);
    if (!r.ok) return r;
    others = r.value.filter((p) => otherIds.includes(p.id));
  }

  const today = localDay(deps.now);
  const range = { from: today, to: shiftDay(today, horizonDays) };
  const nonStudy: BusyBlockInput[] = myBlocks.filter((b) => b.source !== "study");
  const { people } = toPeople([profile.value], [...ownPlaces, ...others], nonStudy, range);
  const person = people[0];
  if (!person) return { ok: false, error: NO_HOME };
  // Vrais temps de trajet entre mes lieux (segment 15), préparés avant tout calcul.
  if (deps.travel.prefetch) {
    await deps.travel
      .prefetch(prefetchRequestsFor([person]), { budgetKey: deps.userId })
      .catch((e: unknown) => console.warn("Temps de trajet (préparation) :", e));
  }

  const accepted = myBlocks
    .map((b) => toAcceptedSession(b, person.homePlaceId))
    .filter((s): s is AcceptedStudySession => s !== null);
  const placeNames = new Map([...ownPlaces, ...others].map((p) => [p.id, p.name]));
  return {
    ok: true,
    value: {
      person,
      deadlines: deadlines.value.map(toDeadline),
      prefs: toStudyPreferences(prefs.value),
      accepted,
      ownPlaceIds: ownPlaces.map((p) => p.id),
      placeNames,
    },
  };
}

// ─── Mise en forme ───────────────────────────────────────────────────────────────────────

/** Séance proposée prête à afficher (sérialisable). */
export interface SessionView {
  key: string;
  deadlineId: string;
  /** Séance acceptée que celle-ci remplace (replanification). */
  replacesId: string | null;
  kind: StudySession["kind"];
  /** « Étude : Chimie » */
  title: string;
  start: string;
  end: string;
  /** Jour local `yyyy-MM-dd` et minutes depuis minuit (grille de /horaire). */
  day: string;
  startMinute: number;
  endMinute: number;
  placeId: string;
  placeName: string;
  /** « mardi 16 septembre, 10 h à 11 h » */
  label: string;
}

const dayMinute = (d: Date) => {
  const [h, m] = formatInTimeZone(d, TIME_ZONE, "HH:mm").split(":").map(Number);
  return h * 60 + m;
};

/** « mardi 16 septembre, 10 h à 11 h » */
export function sessionLabel(start: Date, end: Date, locale: Locale = "fr"): string {
  const day = formatInstantDay(start, "weekdayDayMonth", locale);
  const endMinute = localDay(end) === localDay(start) ? dayMinute(end) : 24 * 60;
  const to = locale === "en" ? "to" : "à";
  return `${day}, ${formatClockLocale(dayMinute(start), locale)} ${to} ${formatClockLocale(endMinute, locale)}`;
}

/** Nom d'un lieu de séance (« Maison » si le lieu n'est plus lisible). */
function studyPlaceName(
  names: ReadonlyMap<string, string>,
  placeId: string,
  homePlaceId: string,
  locale: Locale,
): string {
  const fallback =
    placeId === homePlaceId
      ? locale === "en"
        ? "Home"
        : "Maison"
      : locale === "en"
        ? "Place"
        : "Lieu";
  return names.get(placeId) ?? fallback;
}

export function toSessionView(
  s: StudySession,
  deadline: Deadline,
  placeNames: ReadonlyMap<string, string>,
  homePlaceId: string,
  key: string,
  replacesId: string | null = null,
  locale: Locale = "fr",
): SessionView {
  const day = localDay(s.start);
  return {
    key,
    deadlineId: s.deadlineId,
    replacesId,
    kind: s.kind,
    title: studySessionTitle(s.kind, deadline.course),
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    day,
    startMinute: dayMinute(s.start),
    endMinute: localDay(s.end) === day ? dayMinute(s.end) : 24 * 60,
    placeId: s.placeId,
    placeName: studyPlaceName(placeNames, s.placeId, homePlaceId, locale),
    label: sessionLabel(s.start, s.end, locale),
  };
}

/** Résultat de « Planifier mon étude » ou « Replanifier ». */
export interface StudyPlanView {
  mode: "plan" | "replan";
  sessions: SessionView[];
  warnings: string[];
}

const keyOf = (s: StudySession, i: number) =>
  `${s.deadlineId.slice(0, 8)}-${s.start.getTime().toString(36)}-${i}`;

/** Échéances à planifier : à venir et dans l'horizon. */
function upcoming(loaded: LoadedStudy, now: Date): Deadline[] {
  const limit = now.getTime() + STUDY_HORIZON_DAYS * 86_400_000;
  return loaded.deadlines.filter((d) => d.dueAt.getTime() <= limit && d.dueAt > now);
}

/** « Planifier mon étude » : séances proposées (rien n'est écrit) et avertissements. */
export async function planMyStudy(
  store: StudyStore,
  deps: StudyDeps,
): Promise<Result<StudyPlanView>> {
  const loaded = await loadStudy(store, deps);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  const deadlines = upcoming(l, deps.now);
  if (deadlines.length === 0) {
    return { ok: false, error: "Ajoute d'abord un examen ou un travail à venir." };
  }
  const plan = await planStudySessions(l.person, deadlines, l.prefs, deps.travel, deps.now, {
    accepted: l.accepted,
    studyPlaceIds: l.ownPlaceIds,
  });
  const byId = new Map(deadlines.map((d) => [d.id, d]));
  return {
    ok: true,
    value: {
      mode: "plan",
      sessions: plan.sessions.map((s, i) =>
        toSessionView(
          s,
          byId.get(s.deadlineId)!,
          l.placeNames,
          l.person.homePlaceId,
          keyOf(s, i),
          null,
          deps.locale,
        ),
      ),
      warnings: plan.warnings.map((w) => w.message),
    },
  };
}

/** Séance acceptée en conflit, prête à afficher. */
export interface ConflictView {
  id: string;
  title: string;
  label: string;
}

/** Mes séances acceptées et déplaçables sur lesquelles tombe autre chose. */
export async function myStudyConflicts(
  store: StudyStore,
  deps: StudyDeps,
): Promise<Result<ConflictView[]>> {
  const loaded = await loadStudy(store, deps);
  if (!loaded.ok) return loaded;
  return { ok: true, value: await conflictsOf(loaded.value, deps) };
}

export async function conflictsOf(l: LoadedStudy, deps: StudyDeps): Promise<ConflictView[]> {
  const ids = await findStudyConflicts(
    l.person,
    l.accepted,
    deps.travel,
    l.prefs.bufferMinutes,
    deps.now,
  );
  const courses = new Map(l.deadlines.map((d) => [d.id, d.course]));
  return l.accepted
    .filter((s) => ids.includes(s.id))
    .map((s) => ({
      id: s.id,
      title: studySessionTitle(s.kind, courses.get(s.deadlineId) ?? ""),
      label: sessionLabel(s.start, s.end, deps.locale),
    }));
}

/** « Replanifier » : nouvelles places proposées pour les séances en conflit (rien n'est écrit). */
export async function replanMyConflicts(
  store: StudyStore,
  deps: StudyDeps,
): Promise<Result<StudyPlanView>> {
  const loaded = await loadStudy(store, deps);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  const ids = await findStudyConflicts(
    l.person,
    l.accepted,
    deps.travel,
    l.prefs.bufferMinutes,
    deps.now,
  );
  if (ids.length === 0) return { ok: false, error: "Aucune séance en conflit." };
  // Au plus MAX_REPLAN_SESSIONS séances par calcul (les plus proches) : chaque séance replacée
  // parcourt tous les jours jusqu'à son échéance (revue de sécurité : 900 séances = 63 s).
  // Les autres restent à leur place et comptent comme occupées ; on replanifie de nouveau après.
  const conflicting = l.accepted
    .filter((s) => ids.includes(s.id))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const toMove = conflicting.slice(0, MAX_REPLAN_SESSIONS);
  const moving = new Set(toMove.map((s) => s.id));
  const keep = l.accepted.filter((s) => !moving.has(s.id));
  const leftOver = conflicting.length - toMove.length;
  const { moves, warnings } = await rescheduleStudySessions(
    l.person,
    l.deadlines,
    toMove,
    keep,
    l.prefs,
    deps.travel,
    deps.now,
    { studyPlaceIds: l.ownPlaceIds },
  );
  const byId = new Map(l.deadlines.map((d) => [d.id, d]));
  return {
    ok: true,
    value: {
      mode: "replan",
      sessions: moves.map((m, i) =>
        toSessionView(
          m.session,
          byId.get(m.session.deadlineId)!,
          l.placeNames,
          l.person.homePlaceId,
          keyOf(m.session, i),
          m.id,
          deps.locale,
        ),
      ),
      warnings: [
        ...warnings.map((w) => w.message),
        ...(leftOver > 0
          ? [
              `${leftOver} autre${leftOver > 1 ? "s" : ""} séance${leftOver > 1 ? "s" : ""} en conflit : accepte ces propositions, puis replanifie de nouveau.`,
            ]
          : []),
      ],
    },
  };
}

/** Séances replacées au plus par « Replanifier » (borne le coût du calcul). */
export const MAX_REPLAN_SESSIONS = 20;

/** Résultat d'une acceptation : nombre de séances écrites, ou l'erreur (et la séance visée). */
export type AcceptResult = { ok: true; count: number } | { ok: false; error: string; key?: string };

/** Lignes à écrire après revalidation. */
export interface AcceptancePlan {
  inserts: Array<StudyBlockRow & { deadline_id: string }>;
  updates: Array<{ id: string; row: StudyBlockRow }>;
}

/**
 * Revalide (côté serveur) des séances à accepter, déplacées ou non, dans l'ordre : échéance
 * à moi et à venir, séance remplacée à moi, puis `checkStudySession` (durée, pas de 15 min,
 * pas commencée, avant l'échéance, à un de mes lieux ou à la maison, aucun bloc ni autre
 * séance dessus, trajets compris). Les séances déjà acceptées comptent comme occupées (sauf
 * celles remplacées) ; celles du lot aussi, au fur et à mesure. Tout ou rien : à la première
 * séance refusée, rien n'est à écrire et l'erreur dit laquelle.
 */
export async function prepareAcceptance(
  store: StudyStore,
  inputs: readonly SessionInput[],
  deps: StudyDeps,
): Promise<Result<AcceptancePlan> & { key?: string }> {
  const loaded = await loadStudy(store, deps);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  const deadlines = new Map(l.deadlines.map((d) => [d.id, d]));
  const acceptedById = new Map(l.accepted.map((s) => [s.id, s]));
  const replaced = new Set(inputs.map((i) => i.replacesId).filter((x): x is string => !!x));
  const busy: StudySession[] = l.accepted.filter((s) => !replaced.has(s.id));
  const plan: AcceptancePlan = { inserts: [], updates: [] };

  for (const input of inputs) {
    const fail = (error: string) => ({ ok: false as const, error, key: input.key });
    const deadline = deadlines.get(input.deadlineId);
    if (!deadline) return fail("Échéance introuvable.");
    if (input.replacesId) {
      const old = acceptedById.get(input.replacesId);
      if (!old || old.deadlineId !== input.deadlineId) return fail("Séance introuvable.");
    }
    const session: StudySession = {
      deadlineId: input.deadlineId,
      start: input.start,
      end: input.end,
      placeId: input.placeId,
      kind: input.kind,
    };
    const error = await checkStudySession(
      l.person,
      session,
      deadline,
      busy,
      l.prefs,
      deps.travel,
      deps.now,
      l.ownPlaceIds,
    );
    if (error) return fail(`${sessionLabel(input.start, input.end, deps.locale)} : ${error}`);
    busy.push(session);
    const row = studySessionToRow(session, studySessionTitle(input.kind, deadline.course));
    if (input.replacesId) plan.updates.push({ id: input.replacesId, row });
    else plan.inserts.push({ ...row, deadline_id: deadline.id });
  }
  return { ok: true, value: plan };
}

/**
 * Revalide une séance déplacée par glisser (côté serveur), avec les autres séances proposées
 * encore affichées (`others`) : elle ne doit pas les chevaucher. Renvoie la séance mise en forme.
 */
export async function checkMovedSession(
  store: StudyStore,
  input: SessionInput,
  others: readonly SessionInput[],
  deps: StudyDeps,
): Promise<Result<SessionView>> {
  const loaded = await loadStudy(store, deps);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  const deadline = l.deadlines.find((d) => d.id === input.deadlineId);
  if (!deadline) return { ok: false, error: "Échéance introuvable." };
  if (input.replacesId && !l.accepted.some((s) => s.id === input.replacesId)) {
    return { ok: false, error: "Séance introuvable." };
  }
  const replaced = new Set(
    [input, ...others].map((i) => i.replacesId).filter((x): x is string => !!x),
  );
  const busy: StudySession[] = [
    ...l.accepted.filter((s) => !replaced.has(s.id)),
    ...others.filter((o) => o.key !== input.key),
  ];
  const session: StudySession = {
    deadlineId: input.deadlineId,
    start: input.start,
    end: input.end,
    placeId: input.placeId,
    kind: input.kind,
  };
  const error = await checkStudySession(
    l.person,
    session,
    deadline,
    busy,
    l.prefs,
    deps.travel,
    deps.now,
    l.ownPlaceIds,
  );
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: toSessionView(
      session,
      deadline,
      l.placeNames,
      l.person.homePlaceId,
      input.key,
      input.replacesId,
      deps.locale,
    ),
  };
}

// ─── Page /etude ─────────────────────────────────────────────────────────────────────────

/** Une séance acceptée, prête à afficher dans /etude. */
export interface AcceptedSessionView {
  id: string;
  label: string;
  movable: boolean;
  past: boolean;
  placeName: string;
}

/** Une échéance prête à afficher. */
export interface DeadlineView {
  id: string;
  kind: Deadline["kind"];
  course: string;
  /** « mardi 16 septembre à 13 h » */
  dueLabel: string;
  past: boolean;
  requiredMinutes: number;
  estimated: boolean;
  difficulty: Deadline["difficulty"];
  /** Minutes des séances acceptées (passées et à venir). */
  acceptedMinutes: number;
  sessions: AcceptedSessionView[];
}

/** Contenu de /etude. */
export interface StudyOverview {
  deadlines: DeadlineView[];
  conflicts: ConflictView[];
  /** Pas de maison choisie : on ne peut pas planifier. */
  noHome: boolean;
}

/**
 * Échéances (avec leurs séances acceptées) et séances en conflit. Fonctionne aussi sans maison
 * (on ne peut alors ni planifier ni chercher de conflits).
 */
export async function studyOverview(
  store: StudyStore,
  deps: StudyDeps,
  required: (d: Deadline) => number,
): Promise<Result<StudyOverview>> {
  store = memoStudyStore(store);
  const [profile, places, blocks, deadlines] = await Promise.all([
    store.profile(),
    store.places(),
    store.blocks(),
    store.deadlines(),
  ]);
  if (!profile.ok) return profile;
  if (!places.ok) return places;
  if (!blocks.ok) return blocks;
  if (!deadlines.ok) return deadlines;
  const home = profile.value?.home_place_id ?? "";
  const names = new Map(places.value.map((p) => [p.id, p.name]));
  const locale = deps.locale ?? "fr";
  const accepted = blocks.value
    .filter((b) => b.owner_id === deps.userId)
    .map((b) => toAcceptedSession(b, home))
    .filter((s): s is AcceptedStudySession => s !== null);

  const loaded = await loadStudy(store, deps);
  let conflicts: ConflictView[] = [];
  let noHome = false;
  if (loaded.ok) conflicts = await conflictsOf(loaded.value, deps);
  else if (loaded.error === NO_HOME) noHome = true;
  else return loaded;

  const views = deadlines.value
    .map(toDeadline)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((d): DeadlineView => {
      const sessions = accepted
        .filter((s) => s.deadlineId === d.id)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      return {
        id: d.id,
        kind: d.kind,
        course: d.course,
        dueLabel: `${formatInstantDay(d.dueAt, "weekdayDayMonth", locale)} ${locale === "en" ? "at" : "à"} ${formatClockLocale(dayMinute(d.dueAt), locale)}`,
        past: d.dueAt <= deps.now,
        requiredMinutes: required(d),
        estimated: d.estimatedHours !== null,
        difficulty: d.difficulty,
        acceptedMinutes: sessions.reduce((t, s) => t + minutesBetween(s.start, s.end), 0),
        sessions: sessions.map((s) => ({
          id: s.id,
          label: sessionLabel(s.start, s.end, deps.locale),
          movable: s.movable,
          past: s.end <= deps.now,
          placeName: studyPlaceName(names, s.placeId, home, locale),
        })),
      };
    });
  return { ok: true, value: { deadlines: views, conflicts, noHome } };
}
