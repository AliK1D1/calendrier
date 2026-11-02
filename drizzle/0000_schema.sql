CREATE TYPE "public"."block_source" AS ENUM('manual', 'ics', 'image', 'study');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('proposed', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."travel_mode" AS ENUM('walk', 'bike', 'transit', 'car');--> statement-breakpoint
CREATE TYPE "public"."vote" AS ENUM('yes', 'no', 'maybe');--> statement-breakpoint
CREATE TABLE "busy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"place_id" uuid,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"weekday" smallint,
	"valid_from" date,
	"valid_until" date,
	"source" "block_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "busy_blocks_time_order" CHECK ("busy_blocks"."end_time" > "busy_blocks"."start_time"),
	CONSTRAINT "busy_blocks_weekday_range" CHECK ("busy_blocks"."weekday" is null or "busy_blocks"."weekday" between 1 and 7),
	CONSTRAINT "busy_blocks_validity_order" CHECK ("busy_blocks"."valid_from" is null or "busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" >= "busy_blocks"."valid_from"),
	CONSTRAINT "busy_blocks_one_off_has_day" CHECK ("busy_blocks"."weekday" is not null or ("busy_blocks"."valid_from" is not null and ("busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" = "busy_blocks"."valid_from")))
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"invite_code" text DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_not_blank" CHECK (length(trim("groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "meetup_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"place_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "plan_status" DEFAULT 'proposed' NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetup_plans_time_order" CHECK ("meetup_plans"."ends_at" > "meetup_plans"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"is_group_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_lat_range" CHECK ("places"."lat" between -90 and 90),
	CONSTRAINT "places_lng_range" CHECK ("places"."lng" between -180 and 180),
	CONSTRAINT "places_name_not_blank" CHECK (length(trim("places"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "plan_votes" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid DEFAULT auth.uid() NOT NULL,
	"vote" "vote" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_votes_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"travel_mode" "travel_mode" DEFAULT 'transit' NOT NULL,
	"home_place_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_votes" ADD CONSTRAINT "plan_votes_plan_id_meetup_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meetup_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_votes" ADD CONSTRAINT "plan_votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_home_place_id_places_id_fk" FOREIGN KEY ("home_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busy_blocks_owner_idx" ON "busy_blocks" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_invite_code_key" ON "groups" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "meetup_plans_group_idx" ON "meetup_plans" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "places_owner_idx" ON "places" USING btree ("owner_id");