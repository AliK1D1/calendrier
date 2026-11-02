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

/** Origine d'un bloc occupé. `study` : séance d'étude acceptée (plan, section 3 bis). */
export const blockSourceEnum = pgEnum("block_source", ["manual", "ics", "image", "study"]);

/** Rôle dans un groupe. */
export const groupRoleEnum = pgEnum("group_role", ["admin", "member"]);

/** État d'un plan de rencontre. */
export const planStatusEnum = pgEnum("plan_status", ["proposed", "confirmed", "cancelled"]);

/** Vote sur un plan. */
export const voteEnum = pgEnum("vote", ["yes", "no", "maybe"]);

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

/** Lieu enregistré par un utilisateur (maison, cégep, café favori du groupe…). */
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
    created_at: createdAt(),
  },
  (t) => [
    index("places_owner_idx").on(t.owner_id),
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
    created_at: createdAt(),
  },
  (t) => [
    index("busy_blocks_owner_idx").on(t.owner_id),
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

/** Groupe d'amis. `invite_code` : code du lien d'invitation (généré automatiquement). */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    invite_code: text("invite_code")
      .notNull()
      .default(sql`substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)`),
    created_by: uuid("created_by")
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => profiles.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("groups_invite_code_key").on(t.invite_code),
    check("groups_name_not_blank", sql`length(trim(${t.name})) > 0`),
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

/** Plan de rencontre proposé à un groupe (instants absolus). */
export const meetupPlans = pgTable(
  "meetup_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    group_id: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    place_id: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
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
    check("meetup_plans_time_order", sql`${t.ends_at} > ${t.starts_at}`),
  ],
);

/** Vote d'un membre sur un plan. */
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
  (t) => [primaryKey({ columns: [t.plan_id, t.user_id] })],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type PlaceRow = typeof places.$inferSelect;
export type BusyBlockRow = typeof busyBlocks.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type MeetupPlanRow = typeof meetupPlans.$inferSelect;
export type PlanVoteRow = typeof planVotes.$inferSelect;
