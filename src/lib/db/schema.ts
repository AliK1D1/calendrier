/**
 * Schéma de la base de données (Supabase Postgres), décrit avec Drizzle ORM.
 *
 * - `drizzle-kit generate` produit le SQL des tables dans `drizzle/`.
 * - Les politiques RLS, triggers et fonctions sont dans une migration SQL écrite à la main
 *   (`drizzle/0001_rls_triggers.sql`), car elles dépendent du schéma `auth` de Supabase.
 * - `supabase/setup.sql` regroupe toutes les migrations dans l'ordre (`npm run db:setup-sql`).
 *
 * Les clés TypeScript sont en snake_case, identiques aux colonnes : les types déduits
 * (`$inferSelect`) correspondent donc aux lignes JSON que renvoie supabase-js.
 *
 * Heures : les blocs occupés stockent des heures **locales** (`time`, fuseau America/Toronto)
 * et des jours (`date`), jamais des instants UTC. Un cours hebdomadaire à 10 h reste à 10 h
 * après le changement d'heure. La conversion en instants se fait dans `convert.ts`.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

/** Mode de transport (même valeurs que `TravelMode` dans src/lib/scheduling/types.ts). */
export const travelModeEnum = pgEnum("travel_mode", ["walk", "bike", "transit", "car"]);

/**
 * Origine d'un bloc occupé. `study` : séance d'étude acceptée (plan, section 3 bis).
 * `meetup` : plan de groupe accepté (segment 12) ; le bloc est créé et retiré par la BD
 * (`respond_to_meetup`, `propose_meetup`, `cancel_meetup`), lié au plan par `meetup_plan_id`.
 */
export const blockSourceEnum = pgEnum("block_source", [
  "manual",
  "ics",
  "image",
  "study",
  "meetup",
]);

/** Rôle dans un groupe. */
export const groupRoleEnum = pgEnum("group_role", ["admin", "member"]);

/** État d'un plan de rencontre. */
export const planStatusEnum = pgEnum("plan_status", ["proposed", "confirmed", "cancelled"]);

/** Vote sur un plan. */
export const voteEnum = pgEnum("vote", ["yes", "no", "maybe"]);

/** Type d'échéance (même valeurs que `DeadlineKind` dans src/lib/scheduling/types.ts). */
export const deadlineKindEnum = pgEnum("deadline_kind", ["exam", "assignment"]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

/**
 * Profil d'un utilisateur ; `id` = identifiant Supabase Auth. Créé par un trigger.
 * `onboarded_at` : moment où la personne a fini (ou passé) l'accueil de première connexion
 * (maison, cégep, mode de transport) ; nul tant qu'elle ne l'a pas fait.
 * `unavailable_before` / `unavailable_after` : « heures où je ne sors pas » (heures locales,
 * ex. pas avant 09:00, pas après 22:00), nulles = pas de limite. La logique les traite comme
 * des blocs occupés à la maison (`quietHoursBlocks`).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    display_name: text("display_name").notNull().default(""),
    travel_mode: travelModeEnum("travel_mode").notNull().default("transit"),
    home_place_id: uuid("home_place_id").references((): AnyPgColumn => places.id, {
      onDelete: "set null",
    }),
    onboarded_at: timestamp("onboarded_at", { withTimezone: true, mode: "string" }),
    unavailable_before: time("unavailable_before"),
    unavailable_after: time("unavailable_after"),
    /**
     * Confidentialité : vrai (par défaut) = les membres de mes groupes voient « Occupé » et le
     * lieu, pas le titre de mes blocs. Appliqué par la BD (fonction `group_busy_blocks`).
     */
    hide_block_titles: boolean("hide_block_titles").notNull().default(true),
    created_at: createdAt(),
  },
  (t) => [
    // Même limite que validateDisplayName (le nom est visible par les membres des groupes).
    check("profiles_display_name_length", sql`length(${t.display_name}) <= 60`),
    check(
      "profiles_unavailable_order",
      sql`${t.unavailable_before} is null or ${t.unavailable_after} is null or ${t.unavailable_after} > ${t.unavailable_before}`,
    ),
  ],
);

/**
 * Lieu enregistré par un utilisateur (maison, cégep…) ou lieu favori d'un groupe (café,
 * parc…) : `group_id` renseigné et `is_group_favorite` vrai (les deux vont ensemble). Un lieu
 * de groupe n'est visible que par les membres de ce groupe (RLS, migration 0006).
 */
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_id: uuid("owner_id")
      .notNull()
      .default(sql`auth.uid()`)
      .references((): AnyPgColumn => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    is_group_favorite: boolean("is_group_favorite").notNull().default(false),
    group_id: uuid("group_id").references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [
    index("places_owner_idx").on(t.owner_id),
    index("places_group_idx").on(t.group_id),
    check("places_group_favorite_link", sql`${t.is_group_favorite} = (${t.group_id} is not null)`),
    check("places_lat_range", sql`${t.lat} between -90 and 90`),
    check("places_lng_range", sql`${t.lng} between -180 and 180`),
    check("places_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("places_name_length", sql`length(${t.name}) <= 100`),
  ],
);

/**
 * Bloc occupé.
 * - Hebdomadaire : `weekday` (1 = lundi … 7 = dimanche, ISO), heures locales, et période de
 *   validité facultative `valid_from` → `valid_until` (jours inclus, ex. la session).
 * - Ponctuel : `weekday` nul, le jour est `valid_from` (et `valid_until` nul ou identique).
 * Un bloc ne traverse pas minuit : `end_time` ≤ 24:00 (découper un quart de nuit en deux).
 * `place_id` nul (lieu supprimé) : la conversion utilise la maison de la personne.
 */
export const busyBlocks = pgTable(
  "busy_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_id: uuid("owner_id")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    place_id: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
    start_time: time("start_time").notNull(),
    end_time: time("end_time").notNull(),
    weekday: smallint("weekday"),
    valid_from: date("valid_from", { mode: "string" }),
    valid_until: date("valid_until", { mode: "string" }),
    source: blockSourceEnum("source").notNull().default("manual"),
    /** Plan accepté qui a créé ce bloc (`source = 'meetup'`), sinon nul. */
    meetup_plan_id: uuid("meetup_plan_id").references((): AnyPgColumn => meetupPlans.id, {
      onDelete: "cascade",
    }),
    /**
     * Séance d'étude acceptée (`source = 'study'`, segment 13) : échéance préparée. Toujours une
     * échéance de la même personne (trigger `check_block_deadline_owner`, migration 0011).
     */
    deadline_id: uuid("deadline_id").references((): AnyPgColumn => deadlines.id, {
      onDelete: "cascade",
    }),
    /** Séance d'étude déplaçable : l'app propose de la replacer si autre chose tombe dessus. */
    movable: boolean("movable").notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [
    index("busy_blocks_owner_idx").on(t.owner_id),
    uniqueIndex("busy_blocks_meetup_plan_owner_key").on(t.meetup_plan_id, t.owner_id),
    index("busy_blocks_deadline_idx").on(t.deadline_id),
    // Comparaison en texte : la valeur 'meetup' est ajoutée dans la même transaction.
    check(
      "busy_blocks_meetup_link",
      sql`(${t.source}::text = 'meetup') = (${t.meetup_plan_id} is not null)`,
    ),
    // Segment 13 : une séance d'étude a une échéance, est ponctuelle ; seule elle est déplaçable.
    check(
      "busy_blocks_study_link",
      sql`(${t.source}::text = 'study') = (${t.deadline_id} is not null)`,
    ),
    check("busy_blocks_study_one_off", sql`${t.source}::text <> 'study' or ${t.weekday} is null`),
    check("busy_blocks_movable_study", sql`not ${t.movable} or ${t.source}::text = 'study'`),
    check("busy_blocks_time_order", sql`${t.end_time} > ${t.start_time}`),
    check("busy_blocks_weekday_range", sql`${t.weekday} is null or ${t.weekday} between 1 and 7`),
    check(
      "busy_blocks_validity_order",
      sql`${t.valid_from} is null or ${t.valid_until} is null or ${t.valid_until} >= ${t.valid_from}`,
    ),
    // Mêmes limites que le formulaire (validateBlockForm), appliquées aussi par la BD : la clé
    // « anon » est publique, on peut écrire dans Supabase sans passer par les actions serveur.
    check("busy_blocks_title_length", sql`length(${t.title}) <= 100`),
    check(
      "busy_blocks_validity_span",
      sql`${t.valid_from} is null or ${t.valid_until} is null or ${t.valid_until} - ${t.valid_from} < 366`,
    ),
    check(
      "busy_blocks_one_off_has_day",
      sql`${t.weekday} is not null or (${t.valid_from} is not null and (${t.valid_until} is null or ${t.valid_until} = ${t.valid_from}))`,
    ),
  ],
);

/**
 * Groupe d'amis. `invite_code` : code du lien d'invitation, 32 caractères hexadécimaux
 * aléatoires (122 bits), régénérable par l'admin (`regenerate_invite_code`). On crée un
 * groupe avec `create_group` et on le rejoint avec `join_group_by_code` (migration 0006).
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    invite_code: text("invite_code")
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    created_by: uuid("created_by")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("groups_invite_code_key").on(t.invite_code),
    check("groups_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("groups_name_length", sql`length(${t.name}) <= 60`),
    check("groups_invite_code_format", sql`${t.invite_code} ~ '^[0-9a-f]{32}$'`),
  ],
);

/** Appartenance à un groupe. */
export const groupMembers = pgTable(
  "group_members",
  {
    group_id: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: groupRoleEnum("role").notNull().default("member"),
    joined_at: timestamp("joined_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.group_id, t.user_id] }),
    index("group_members_user_idx").on(t.user_id),
  ],
);

/**
 * Plan de rencontre proposé à un groupe (instants absolus). Segment 12 : créé par
 * `propose_meetup`, annulé par son créateur (`cancel_meetup`, statut `cancelled`) ; pas
 * d'écriture directe. `location` : lieu écrit à la main quand aucun lieu enregistré n'est choisi.
 * `confirmed` n'est pas utilisé : chaque invité accepte ou refuse pour lui-même.
 */
export const meetupPlans = pgTable(
  "meetup_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    group_id: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    place_id: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    location: text("location").notNull().default(""),
    starts_at: timestamp("starts_at", { withTimezone: true, mode: "string" }).notNull(),
    ends_at: timestamp("ends_at", { withTimezone: true, mode: "string" }).notNull(),
    status: planStatusEnum("status").notNull().default("proposed"),
    created_by: uuid("created_by")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [
    index("meetup_plans_group_idx").on(t.group_id),
    index("meetup_plans_created_by_idx").on(t.created_by),
    check("meetup_plans_time_order", sql`${t.ends_at} > ${t.starts_at}`),
    check("meetup_plans_title_length", sql`length(${t.title}) <= 80`),
    check("meetup_plans_location_length", sql`length(${t.location}) <= 100`),
    // Revue : mêmes caractères interdits que le formulaire (tabulation et retour à la ligne permis).
    check("meetup_plans_title_chars", sql`${t.title} !~ '[\\x01-\\x08\\x0b-\\x1f\\x7f-\\x9f]'`),
    check(
      "meetup_plans_location_chars",
      sql`${t.location} !~ '[\\x01-\\x08\\x0b-\\x1f\\x7f-\\x9f]'`,
    ),
    check("meetup_plans_max_duration", sql`${t.ends_at} - ${t.starts_at} <= interval '12 hours'`),
  ],
);

/**
 * Personnes invitées à un plan (segment 12) : tout le groupe ou des membres choisis, toujours
 * avec le créateur. Seuls les invités répondent ; les autres membres voient le plan.
 */
export const planInvitees = pgTable(
  "plan_invitees",
  {
    plan_id: uuid("plan_id")
      .notNull()
      .references(() => meetupPlans.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.plan_id, t.user_id] }),
    index("plan_invitees_user_idx").on(t.user_id),
  ],
);

/** Réponse d'un invité à un plan : `yes` = accepté, `no` = refusé (`maybe` n'est plus permis). */
export const planVotes = pgTable(
  "plan_votes",
  {
    plan_id: uuid("plan_id")
      .notNull()
      .references(() => meetupPlans.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    vote: voteEnum("vote").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.plan_id, t.user_id] }),
    check("plan_votes_yes_no", sql`${t.vote} <> 'maybe'`),
  ],
);

/**
 * Examen ou travail à remettre (segment 13). Visible et modifiable **seulement** par son
 * propriétaire (RLS, migration 0011). `estimated_hours` nul : défaut selon `difficulty`
 * (3 h, 5 h, 8 h). Limites : 100 échéances par personne, date dans l'année qui vient
 * (trigger `enforce_deadline_limits`).
 */
export const deadlines = pgTable(
  "deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_id: uuid("owner_id")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: deadlineKindEnum("kind").notNull().default("exam"),
    course: text("course").notNull(),
    due_at: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
    estimated_hours: doublePrecision("estimated_hours"),
    difficulty: smallint("difficulty").notNull().default(2),
    created_at: createdAt(),
  },
  (t) => [
    index("deadlines_owner_idx").on(t.owner_id),
    check("deadlines_course_not_blank", sql`length(trim(${t.course})) > 0`),
    check("deadlines_course_length", sql`length(${t.course}) <= 80`),
    // Une seule ligne : aucun caractère de contrôle (ni tabulation ni retour à la ligne).
    check("deadlines_course_chars", sql`${t.course} !~ '[\\x01-\\x1f\\x7f-\\x9f]'`),
    check(
      "deadlines_estimated_hours_range",
      sql`${t.estimated_hours} is null or (${t.estimated_hours} >= 0.5 and ${t.estimated_hours} <= 60 and ${t.estimated_hours} * 2 = floor(${t.estimated_hours} * 2))`,
    ),
    check("deadlines_difficulty_range", sql`${t.difficulty} between 1 and 3`),
    check(
      "deadlines_due_at_range",
      sql`${t.due_at} >= '2020-01-01' and ${t.due_at} < '2100-01-01'`,
    ),
  ],
);

/**
 * Préférences d'étude (segment 14, réglées dans /profil), une ligne par personne, visibles
 * seulement par elle. Absente : préférences par défaut (`DEFAULT_STUDY_PREFERENCES`).
 */
export const studyPreferences = pgTable(
  "study_preferences",
  {
    owner_id: uuid("owner_id")
      .primaryKey()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    min_session_minutes: smallint("min_session_minutes").notNull().default(45),
    max_session_minutes: smallint("max_session_minutes").notNull().default(120),
    max_minutes_per_day: smallint("max_minutes_per_day").notNull().default(180),
    break_minutes: smallint("break_minutes").notNull().default(15),
    study_start: time("study_start").notNull().default("08:00"),
    study_end: time("study_end").notNull().default("22:00"),
    /** La veille d'un examen, pas d'étude après cette heure ; nul = pas de limite. */
    eve_cutoff: time("eve_cutoff").default("21:00"),
    /** Part du temps libre des soirées et fins de semaine gardée libre, en %. */
    keep_free_percent: smallint("keep_free_percent").notNull().default(30),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "study_preferences_min_session",
      sql`${t.min_session_minutes} between 30 and 120 and ${t.min_session_minutes} % 15 = 0`,
    ),
    check(
      "study_preferences_max_session",
      sql`${t.max_session_minutes} between ${t.min_session_minutes} and 240 and ${t.max_session_minutes} % 15 = 0`,
    ),
    check(
      "study_preferences_max_per_day",
      sql`${t.max_minutes_per_day} between ${t.min_session_minutes} and 600 and ${t.max_minutes_per_day} % 15 = 0`,
    ),
    check("study_preferences_break", sql`${t.break_minutes} between 0 and 60`),
    check(
      "study_preferences_hours",
      sql`${t.study_end} - ${t.study_start} >= make_interval(mins => ${t.min_session_minutes})`,
    ),
    check("study_preferences_keep_free", sql`${t.keep_free_percent} between 0 and 90`),
  ],
);

/**
 * Disponibilité ponctuelle (segment 18) : « ce samedi, je suis libre de 13 h à 18 h ». Heures
 * **locales** d'un jour, comme les blocs ponctuels. Ce jour-là, pour les rencontres, la
 * personne n'est disponible que pendant ses disponibilités : le reste de la journée compte
 * comme occupé, et ses blocs **hebdomadaires** (et heures « je ne sors pas ») sont levés
 * pendant ces heures-là ; ses blocs ponctuels (plans acceptés, séances…) comptent toujours
 * (`applyOneOffAvailability`). Modifiable seulement par la personne ; les membres de ses
 * groupes voient le jour et les heures par `group_availability_slots`, jamais la note.
 * Limites : 100 à venir par personne, jour entre hier et dans un an (trigger, migration 0012).
 */
export const availabilitySlots = pgTable(
  "availability_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_id: uuid("owner_id")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    start_time: time("start_time").notNull(),
    end_time: time("end_time").notNull(),
    /** Note privée (ex. « pas de shift »), jamais montrée aux autres. */
    note: text("note").notNull().default(""),
    created_at: createdAt(),
  },
  (t) => [
    index("availability_slots_owner_day_idx").on(t.owner_id, t.day),
    // Au moins 15 min ; « 24:00 » = minuit suivant (une disponibilité ne traverse pas minuit).
    check(
      "availability_slots_time_order",
      sql`${t.end_time} - ${t.start_time} >= interval '15 minutes'`,
    ),
    check(
      "availability_slots_day_range",
      sql`${t.day} >= '2020-01-01' and ${t.day} < '2100-01-01'`,
    ),
    check("availability_slots_note_length", sql`length(${t.note}) <= 60`),
    // Une seule ligne : aucun caractère de contrôle (ni tabulation ni retour à la ligne).
    check("availability_slots_note_chars", sql`${t.note} !~ '[\\x01-\\x1f\\x7f-\\x9f]'`),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type PlaceRow = typeof places.$inferSelect;
export type BusyBlockRow = typeof busyBlocks.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type MeetupPlanRow = typeof meetupPlans.$inferSelect;
export type PlanVoteRow = typeof planVotes.$inferSelect;
export type PlanInviteeRow = typeof planInvitees.$inferSelect;
export type DeadlineRow = typeof deadlines.$inferSelect;
export type StudyPreferencesRow = typeof studyPreferences.$inferSelect;
export type AvailabilitySlotRow = typeof availabilitySlots.$inferSelect;
