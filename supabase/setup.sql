-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : mise en place complète de la base de données Supabase.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/*.sql : ne pas le modifier
-- à la main (modifier src/lib/db/schema.ts ou drizzle/0001_rls_triggers.sql, puis régénérer).
--
-- À exécuter UNE SEULE FOIS sur une base vide : Supabase → SQL Editor → New query →
-- coller tout le fichier → Run. Tout se fait dans une transaction : en cas d'erreur, rien
-- n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0000_schema ───────────────────────────────────────────────────────────

CREATE TYPE "public"."block_source" AS ENUM('manual', 'ics', 'image', 'study');
CREATE TYPE "public"."group_role" AS ENUM('admin', 'member');
CREATE TYPE "public"."plan_status" AS ENUM('proposed', 'confirmed', 'cancelled');
CREATE TYPE "public"."travel_mode" AS ENUM('walk', 'bike', 'transit', 'car');
CREATE TYPE "public"."vote" AS ENUM('yes', 'no', 'maybe');
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

CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);

CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"invite_code" text DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_not_blank" CHECK (length(trim("groups"."name")) > 0)
);

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

CREATE TABLE "plan_votes" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid DEFAULT auth.uid() NOT NULL,
	"vote" "vote" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_votes_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);

CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"travel_mode" "travel_mode" DEFAULT 'transit' NOT NULL,
	"home_place_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "places" ADD CONSTRAINT "places_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plan_votes" ADD CONSTRAINT "plan_votes_plan_id_meetup_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meetup_plans"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plan_votes" ADD CONSTRAINT "plan_votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_home_place_id_places_id_fk" FOREIGN KEY ("home_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "busy_blocks_owner_idx" ON "busy_blocks" USING btree ("owner_id");
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");
CREATE UNIQUE INDEX "groups_invite_code_key" ON "groups" USING btree ("invite_code");
CREATE INDEX "meetup_plans_group_idx" ON "meetup_plans" USING btree ("group_id");
CREATE INDEX "places_owner_idx" ON "places" USING btree ("owner_id");

-- ─── Migration 0001_rls_triggers ─────────────────────────────────────────────────────

-- Migration écrite à la main : fonctions, triggers, droits et politiques RLS.
-- Règle : un utilisateur voit ses données et celles des membres de ses groupes ;
-- il ne modifie que les siennes.
--
-- Les fonctions d'aide sont SECURITY DEFINER : elles lisent group_members sans repasser par
-- ses propres politiques RLS (sinon une politique de group_members qui lit group_members
-- boucle à l'infini : « infinite recursion detected in policy »).
-- search_path vide + noms qualifiés : recommandé par Supabase pour les SECURITY DEFINER.

-- ─── Fonctions d'aide ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_group_member(gid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = gid AND m.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(gid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = gid AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'
  );
$$;

-- Vrai si `other` est l'utilisateur connecté ou partage au moins un groupe avec lui.
CREATE OR REPLACE FUNCTION public.shares_group_with(other uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT other = (SELECT auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.group_members mine
    JOIN public.group_members theirs ON theirs.group_id = mine.group_id
    WHERE mine.user_id = (SELECT auth.uid()) AND theirs.user_id = other
  );
$$;

-- Rejoindre un groupe avec son code d'invitation (un non-membre ne peut pas lire `groups`).
CREATE OR REPLACE FUNCTION public.join_group_by_code(code text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  gid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  SELECT g.id INTO gid FROM public.groups g WHERE g.invite_code = trim(code);
  IF gid IS NULL THEN
    RAISE EXCEPTION 'Code d''invitation invalide' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (gid, uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN gid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.is_group_admin(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.shares_group_with(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.join_group_by_code(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.shares_group_with(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.join_group_by_code(text) TO authenticated;


-- ─── Triggers ──────────────────────────────────────────────────────────────────────────────

-- Création du profil à l'inscription (lien magique ou Google).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    coalesce(
      nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
      ''
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Le créateur d'un groupe en devient l'administrateur.
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin')
  ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_group_created ON public.groups;

CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan_votes_touch ON public.plan_votes;

CREATE TRIGGER plan_votes_touch
  BEFORE UPDATE ON public.plan_votes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.handle_new_group() FROM PUBLIC;


-- ─── Droits sur les tables ─────────────────────────────────────────────────────────────────
-- Les visiteurs non connectés (anon) n'ont accès à rien ; RLS filtre le reste.

REVOKE ALL ON public.profiles, public.places, public.busy_blocks, public.groups,
  public.group_members, public.meetup_plans, public.plan_votes FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.places, public.busy_blocks,
  public.groups, public.group_members, public.meetup_plans, public.plan_votes TO authenticated;


-- ─── Row Level Security ────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.busy_blocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meetup_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plan_votes ENABLE ROW LEVEL SECURITY;


-- profiles : je vois mon profil et ceux des membres de mes groupes ; je modifie le mien.
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.shares_group_with(id));

CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (
      home_place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = home_place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );


-- places : mêmes règles.
CREATE POLICY places_select ON public.places FOR SELECT TO authenticated
  USING (public.shares_group_with(owner_id));

CREATE POLICY places_insert ON public.places FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY places_update ON public.places FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY places_delete ON public.places FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- busy_blocks : l'horaire. Lisible par moi et les membres de mes groupes seulement.
CREATE POLICY busy_blocks_select ON public.busy_blocks FOR SELECT TO authenticated
  USING (public.shares_group_with(owner_id));

CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY busy_blocks_delete ON public.busy_blocks FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- groups : visibles par leurs membres (et leur créateur, pour INSERT … RETURNING).
CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated
  USING (public.is_group_member(id) OR created_by = (SELECT auth.uid()));

CREATE POLICY groups_insert ON public.groups FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY groups_update ON public.groups FOR UPDATE TO authenticated
  USING (public.is_group_admin(id))
  WITH CHECK (public.is_group_admin(id));

CREATE POLICY groups_delete ON public.groups FOR DELETE TO authenticated
  USING (public.is_group_admin(id));


-- group_members : on entre par join_group_by_code (ou en créant le groupe) ; pas d'INSERT
-- direct. On peut quitter un groupe ; l'admin peut retirer un membre ou changer un rôle.
CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY group_members_update ON public.group_members FOR UPDATE TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY group_members_delete ON public.group_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_group_admin(group_id));


-- meetup_plans : visibles par les membres du groupe ; créés par un membre, modifiés par
-- leur créateur. Le lieu doit appartenir à un membre du groupe.
CREATE POLICY meetup_plans_select ON public.meetup_plans FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY meetup_plans_insert ON public.meetup_plans FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_group_member(group_id)
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        JOIN public.group_members gm ON gm.user_id = p.owner_id
        WHERE p.id = place_id AND gm.group_id = meetup_plans.group_id
      )
    )
  );

CREATE POLICY meetup_plans_update ON public.meetup_plans FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_group_member(group_id)
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        JOIN public.group_members gm ON gm.user_id = p.owner_id
        WHERE p.id = place_id AND gm.group_id = meetup_plans.group_id
      )
    )
  );

CREATE POLICY meetup_plans_delete ON public.meetup_plans FOR DELETE TO authenticated
  USING (created_by = (SELECT auth.uid()));


-- plan_votes : visibles par les membres du groupe du plan ; chacun gère son propre vote.
CREATE POLICY plan_votes_select ON public.plan_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY plan_votes_insert ON public.plan_votes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY plan_votes_update ON public.plan_votes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY plan_votes_delete ON public.plan_votes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;
