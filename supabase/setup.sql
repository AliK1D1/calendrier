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

-- ─── Migration 0002_review_hardening ─────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 6).
--
-- Faille corrigée : les politiques group_members_update et groups_update vérifient seulement
-- que l'auteur est admin du groupe. Or un UPDATE peut changer n'importe quelle colonne. Un
-- admin (donc n'importe qui : il suffit de créer un groupe) pouvait réécrire une ligne de
-- membre « UPDATE group_members SET user_id = <inconnu> » et ajouter de force un inconnu à
-- son groupe, puis lire son horaire et ses lieux (shares_group_with devient vrai).
--
-- Correctif : droits par colonne. Sur group_members, on ne peut modifier que le rôle ; sur
-- groups, que le nom et le code d'invitation. Les politiques RLS restent les mêmes.

REVOKE UPDATE ON public.group_members FROM authenticated;

GRANT UPDATE (role) ON public.group_members TO authenticated;

REVOKE UPDATE ON public.groups FROM authenticated;

GRANT UPDATE (name, invite_code) ON public.groups TO authenticated;


-- Supabase donne par défaut EXECUTE sur les nouvelles fonctions à anon (droits par défaut du
-- schéma public), ce que « REVOKE … FROM PUBLIC » n'enlève pas. Les visiteurs non connectés
-- n'ont besoin d'aucune de ces fonctions.
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid), public.is_group_admin(uuid),
  public.shares_group_with(uuid), public.join_group_by_code(text),
  public.handle_new_user(), public.handle_new_group() FROM anon;

-- ─── Migration 0003_onboarding ───────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "onboarded_at" timestamp with time zone;
ALTER TABLE "places" ADD CONSTRAINT "places_name_length" CHECK (length("places"."name") <= 100);


-- ─── Accueil de première connexion (écrit à la main) ──────────────────────────────────────
-- Enregistre en une seule transaction la maison, le cégep/école (facultatif) et le mode de
-- transport, puis marque le profil comme accueilli. SECURITY INVOKER : la RLS de places et
-- profiles s'applique normalement (on n'écrit que chez soi). Sans effet si l'accueil est déjà
-- fait (un double envoi du formulaire ne crée pas de lieux en double). Tous les paramètres
-- nuls : « passer pour l'instant ».
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  home_name text DEFAULT NULL,
  home_lat double precision DEFAULT NULL,
  home_lng double precision DEFAULT NULL,
  school_name text DEFAULT NULL,
  school_lat double precision DEFAULT NULL,
  school_lng double precision DEFAULT NULL,
  mode public.travel_mode DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  home_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  -- Verrouille la ligne du profil : deux envois simultanés passent l'un après l'autre.
  PERFORM 1 FROM public.profiles WHERE id = uid AND onboarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF home_name IS NOT NULL THEN
    INSERT INTO public.places (owner_id, name, lat, lng)
    VALUES (uid, trim(home_name), home_lat, home_lng)
    RETURNING id INTO home_id;
  END IF;
  IF school_name IS NOT NULL THEN
    INSERT INTO public.places (owner_id, name, lat, lng)
    VALUES (uid, trim(school_name), school_lat, school_lng);
  END IF;
  UPDATE public.profiles
  SET travel_mode = coalesce(mode, travel_mode),
      home_place_id = coalesce(home_id, home_place_id),
      onboarded_at = now()
  WHERE id = uid;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(text, double precision, double precision, text, double precision, double precision, public.travel_mode) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, double precision, double precision, text, double precision, double precision, public.travel_mode) TO authenticated;

-- ─── Migration 0004_quiet_hours ──────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "unavailable_before" time;
ALTER TABLE "profiles" ADD COLUMN "unavailable_after" time;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unavailable_order" CHECK ("profiles"."unavailable_before" is null or "profiles"."unavailable_after" is null or "profiles"."unavailable_after" > "profiles"."unavailable_before");

-- ─── Migration 0005_review_limits ────────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 8) : la base applique les mêmes limites que les
-- formulaires. La clé « anon » est publique : une personne connectée peut écrire directement
-- dans Supabase (API REST) sans passer par les actions serveur et leur validation.
-- NOT VALID : la règle vaut pour toute nouvelle écriture, sans échouer sur d'éventuelles
-- lignes déjà enregistrées.
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_title_length" CHECK (length("busy_blocks"."title") <= 100) NOT VALID;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_validity_span" CHECK ("busy_blocks"."valid_from" is null or "busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" - "busy_blocks"."valid_from" < 366) NOT VALID;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_display_name_length" CHECK (length("profiles"."display_name") <= 60) NOT VALID;
-- Le nom tiré du compte Google ou du courriel peut dépasser 60 caractères : on le coupe, sinon
-- la nouvelle limite ferait échouer l'inscription.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    left(
      coalesce(
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
        ''
      ),
      60
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;

-- ─── Migration 0006_groups ───────────────────────────────────────────────────────────

-- Segment 10 : groupes et amis. Début généré par drizzle-kit (colonnes, clé étrangère, index),
-- réordonné pour corriger les données existantes AVANT d'ajouter les contraintes ; suite écrite
-- à la main (fonctions, triggers, droits, politiques RLS).
ALTER TABLE "places" ADD COLUMN "group_id" uuid;
ALTER TABLE "profiles" ADD COLUMN "hide_block_titles" boolean DEFAULT true NOT NULL;
ALTER TABLE "places" ADD CONSTRAINT "places_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "places_group_idx" ON "places" USING btree ("group_id");
-- Code d'invitation : 32 caractères hexadécimaux aléatoires (122 bits) au lieu de 12. Les codes
-- existants trop courts sont remplacés (les anciens liens cessent de marcher).
ALTER TABLE "groups" ALTER COLUMN "invite_code" SET DEFAULT replace(gen_random_uuid()::text, '-', '');
UPDATE "groups" SET "invite_code" = replace(gen_random_uuid()::text, '-', '')
  WHERE "invite_code" !~ '^[0-9a-f]{32}$';
ALTER TABLE "groups" ADD CONSTRAINT "groups_invite_code_format" CHECK ("groups"."invite_code" ~ '^[0-9a-f]{32}$');
-- NOT VALID : un éventuel ancien nom trop long reste, toute nouvelle écriture respecte la limite.
ALTER TABLE "groups" ADD CONSTRAINT "groups_name_length" CHECK (length("groups"."name") <= 60) NOT VALID;
-- `is_group_favorite` n'était utilisé nulle part : il devient « a un groupe ».
UPDATE "places" SET "is_group_favorite" = false WHERE "is_group_favorite" AND "group_id" IS NULL;
ALTER TABLE "places" ADD CONSTRAINT "places_group_favorite_link" CHECK ("places"."is_group_favorite" = ("places"."group_id" is not null));


-- ─── Confidentialité de l'horaire ─────────────────────────────────────────────────────────
-- Avant : les membres d'un groupe lisaient directement busy_blocks des autres (titres
-- compris), par l'API REST avec la clé anon et leur jeton. Masquer le titre dans l'interface
-- ne suffisait donc pas. Maintenant : busy_blocks n'est lisible que par son propriétaire ;
-- l'horaire des autres membres passe par group_busy_blocks, qui remplace le titre par
-- « Occupé » quand le propriétaire l'a choisi (profiles.hide_block_titles, vrai par défaut).
-- Le lieu (place_id) reste visible : c'est le « lieu général » (lisible selon la RLS de places).
DROP POLICY busy_blocks_select ON public.busy_blocks;

CREATE POLICY busy_blocks_select ON public.busy_blocks FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.group_busy_blocks(gid uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  title text,
  title_hidden boolean,
  place_id uuid,
  start_time time,
  end_time time,
  weekday smallint,
  valid_from date,
  valid_until date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid()) OR NOT p.hide_block_titles
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid()) AND p.hide_block_titles,
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until
  FROM public.busy_blocks b
  JOIN public.group_members m ON m.user_id = b.owner_id AND m.group_id = gid
  JOIN public.profiles p ON p.id = b.owner_id
  WHERE public.is_group_member(gid)
  ORDER BY b.owner_id, b.weekday NULLS LAST, b.valid_from, b.start_time;
$$;


-- ─── Lieux favoris du groupe ──────────────────────────────────────────────────────────────
-- Un lieu de groupe (group_id renseigné) n'est visible que par les membres de ce groupe, pas
-- par ceux qui partagent un AUTRE groupe avec son auteur. On ne peut rattacher un lieu qu'à un
-- groupe dont on est membre. L'auteur ou un admin du groupe peut le supprimer.
DROP POLICY places_select ON public.places;

CREATE POLICY places_select ON public.places FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (group_id IS NULL AND public.shares_group_with(owner_id))
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY places_insert ON public.places;

CREATE POLICY places_insert ON public.places FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (group_id IS NULL OR public.is_group_member(group_id))
  );

DROP POLICY places_update ON public.places;

CREATE POLICY places_update ON public.places FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (group_id IS NULL OR public.is_group_member(group_id))
  );

DROP POLICY places_delete ON public.places;

CREATE POLICY places_delete ON public.places FOR DELETE TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (group_id IS NOT NULL AND public.is_group_admin(group_id))
  );

-- Plans : le lieu d'un plan est un lieu d'un membre, et pas le favori d'un autre groupe.
DROP POLICY meetup_plans_insert ON public.meetup_plans;

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
          AND (p.group_id IS NULL OR p.group_id = meetup_plans.group_id)
      )
    )
  );

DROP POLICY meetup_plans_update ON public.meetup_plans;

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
          AND (p.group_id IS NULL OR p.group_id = meetup_plans.group_id)
      )
    )
  );


-- ─── Groupes : créer, voir, code d'invitation ─────────────────────────────────────────────
-- Avant : groups_select laissait aussi voir un groupe à son créateur (pour INSERT …
-- RETURNING), même après l'avoir quitté (nom et code d'invitation compris). Maintenant on
-- crée un groupe avec create_group et seuls les membres voient un groupe.
DROP POLICY groups_select ON public.groups;

CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated
  USING (public.is_group_member(id));

DROP POLICY groups_insert ON public.groups;

REVOKE INSERT ON public.groups FROM authenticated;

-- L'admin renomme le groupe ; le code ne change que par regenerate_invite_code (toujours
-- aléatoire : pas de code faible ou choisi à la main).
REVOKE UPDATE (invite_code) ON public.groups FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_group(group_name text)
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
  -- Le trigger on_group_created ajoute le créateur comme admin.
  INSERT INTO public.groups (name, created_by)
  VALUES (trim(group_name), uid)
  RETURNING id INTO gid;
  RETURN gid;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(gid uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_code text;
BEGIN
  IF NOT public.is_group_admin(gid) THEN
    RAISE EXCEPTION 'Réservé à l''admin du groupe' USING ERRCODE = '42501';
  END IF;
  UPDATE public.groups SET invite_code = replace(gen_random_uuid()::text, '-', '')
  WHERE id = gid
  RETURNING invite_code INTO new_code;
  RETURN new_code;
END;
$$;

-- Aperçu pour la page /rejoindre/[code] : nom du groupe et nombre de membres, seulement pour
-- qui a le code (un non-membre ne peut pas lire `groups`). Aucune ligne si le code est faux.
CREATE OR REPLACE FUNCTION public.group_invite_preview(code text)
RETURNS TABLE (group_id uuid, name text, member_count integer, already_member boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT g.id, g.name,
    (SELECT count(*)::integer FROM public.group_members m WHERE m.group_id = g.id),
    public.is_group_member(g.id)
  FROM public.groups g
  WHERE (SELECT auth.uid()) IS NOT NULL AND g.invite_code = lower(trim(code));
$$;

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
  SELECT g.id INTO gid FROM public.groups g WHERE g.invite_code = lower(trim(code));
  IF gid IS NULL THEN
    RAISE EXCEPTION 'Code d''invitation invalide' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (gid, uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN gid;
END;
$$;


-- ─── Quitter / retirer : jamais de groupe sans admin ──────────────────────────────────────
-- Règle choisie : quand le dernier admin part (ou est retiré), le membre le plus ancien
-- devient admin ; quand le dernier membre part, le groupe est supprimé (avec ses lieux
-- favoris et ses plans). Rétrograder le dernier admin en simple membre est refusé.
CREATE OR REPLACE FUNCTION public.handle_member_removed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = OLD.group_id) THEN
    RETURN NULL; -- groupe en cours de suppression (cascade)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.group_id = OLD.group_id) THEN
    DELETE FROM public.groups WHERE id = OLD.group_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.group_members m WHERE m.group_id = OLD.group_id AND m.role = 'admin'
  ) THEN
    UPDATE public.group_members SET role = 'admin'
    WHERE group_id = OLD.group_id AND user_id = (
      SELECT m.user_id FROM public.group_members m
      WHERE m.group_id = OLD.group_id
      ORDER BY m.joined_at, m.user_id
      LIMIT 1
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_group_member_removed ON public.group_members;

CREATE TRIGGER on_group_member_removed
  AFTER DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_member_removed();

CREATE OR REPLACE FUNCTION public.ensure_group_has_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members m WHERE m.group_id = NEW.group_id AND m.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Le groupe doit garder au moins un admin' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_group_admin_demoted ON public.group_members;

CREATE TRIGGER on_group_admin_demoted
  AFTER UPDATE OF role ON public.group_members
  FOR EACH ROW WHEN (OLD.role = 'admin' AND NEW.role <> 'admin')
  EXECUTE FUNCTION public.ensure_group_has_admin();


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
-- Supabase donne par défaut EXECUTE à anon sur les nouvelles fonctions du schéma public :
-- on le retire explicitement (en plus de PUBLIC).
REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid), public.create_group(text),
  public.regenerate_invite_code(uuid), public.group_invite_preview(text),
  public.join_group_by_code(text), public.handle_member_removed(),
  public.ensure_group_has_admin(), public.touch_updated_at() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid), public.create_group(text),
  public.regenerate_invite_code(uuid), public.group_invite_preview(text),
  public.join_group_by_code(text) TO authenticated;

-- ─── Migration 0007_review_kick_new_code ─────────────────────────────────────────────

-- Migration de la revue sécurité (segment 10).
--
-- Faille corrigée : un membre retiré du groupe par un admin pouvait revenir aussitôt avec le
-- même lien d'invitation (tous les membres voient le lien), sans que personne ne le remarque,
-- et relire l'horaire et les lieux des membres. Maintenant, quand un membre est retiré par
-- QUELQU'UN D'AUTRE, le code d'invitation est remplacé : l'ancien lien cesse de marcher.
-- Rien ne change quand on quitte soi-même le groupe, ni à la suppression d'un compte (pas de
-- session : auth.uid() est nul).
CREATE OR REPLACE FUNCTION public.handle_member_removed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = OLD.group_id) THEN
    RETURN NULL; -- groupe en cours de suppression (cascade)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.group_id = OLD.group_id) THEN
    DELETE FROM public.groups WHERE id = OLD.group_id;
    RETURN NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.group_members m WHERE m.group_id = OLD.group_id AND m.role = 'admin'
  ) THEN
    UPDATE public.group_members SET role = 'admin'
    WHERE group_id = OLD.group_id AND user_id = (
      SELECT m.user_id FROM public.group_members m
      WHERE m.group_id = OLD.group_id
      ORDER BY m.joined_at, m.user_id
      LIMIT 1
    );
  END IF;
  -- Retiré par un admin (et pas parti de lui-même) : nouveau code d'invitation.
  IF (SELECT auth.uid()) IS NOT NULL AND OLD.user_id <> (SELECT auth.uid()) THEN
    UPDATE public.groups SET invite_code = replace(gen_random_uuid()::text, '-', '')
    WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_member_removed() FROM PUBLIC, anon;

-- ─── Migration 0008_review_row_limits ────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 11).
--
-- Faille corrigée : aucune limite sur le nombre de lieux et de blocs d'horaire. Avec la clé
-- anon (publique) et son jeton, une personne pouvait en créer des dizaines de milliers par
-- l'API REST. Les membres de ses groupes les chargent ensuite à chaque visite de la page du
-- groupe et à chaque recherche de moments. Les limites sont très au-dessus d'un usage normal
-- (un horaire de cégep : 20 à 40 blocs, quelques lieux).
CREATE OR REPLACE FUNCTION public.enforce_row_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'busy_blocks' THEN
    IF (SELECT count(*) FROM public.busy_blocks b WHERE b.owner_id = NEW.owner_id) >= 1000 THEN
      RAISE EXCEPTION 'Trop de blocs dans l''horaire (1000 au maximum)' USING ERRCODE = '54000';
    END IF;
  ELSIF TG_TABLE_NAME = 'places' THEN
    IF TG_OP = 'INSERT'
      AND (SELECT count(*) FROM public.places p WHERE p.owner_id = NEW.owner_id) >= 200 THEN
      RAISE EXCEPTION 'Trop de lieux (200 au maximum)' USING ERRCODE = '54000';
    END IF;
    IF NEW.group_id IS NOT NULL
      AND (TG_OP = 'INSERT' OR OLD.group_id IS DISTINCT FROM NEW.group_id)
      AND (SELECT count(*) FROM public.places p WHERE p.group_id = NEW.group_id) >= 100 THEN
      RAISE EXCEPTION 'Trop de lieux dans ce groupe (100 au maximum)' USING ERRCODE = '54000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS busy_blocks_row_limit ON public.busy_blocks;

CREATE TRIGGER busy_blocks_row_limit
  BEFORE INSERT ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_limits();

DROP TRIGGER IF EXISTS places_row_limit ON public.places;

CREATE TRIGGER places_row_limit
  BEFORE INSERT OR UPDATE OF group_id ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_limits();

REVOKE EXECUTE ON FUNCTION public.enforce_row_limits() FROM PUBLIC, anon;

-- ─── Migration 0009_segment12_meetup_invites ─────────────────────────────────────────

-- Segment 12 : proposer un moment au groupe. Début généré par drizzle-kit (colonnes, table
-- plan_invitees, contraintes ; NOT VALID ajouté là où d'anciennes lignes pourraient ne pas
-- respecter la règle), suite écrite à la main (droits, RLS, fonctions, triggers).
--
-- La valeur 'meetup' est ajoutée au type block_source dans cette même transaction : Postgres
-- interdit de l'utiliser avant le COMMIT. Les contraintes et politiques la comparent donc en
-- texte (source::text), et seules des fonctions plpgsql (lues à leur première exécution)
-- l'écrivent.
ALTER TYPE "public"."block_source" ADD VALUE 'meetup';
CREATE TABLE "plan_invitees" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "plan_invitees_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);

ALTER TABLE "busy_blocks" ADD COLUMN "meetup_plan_id" uuid;
ALTER TABLE "meetup_plans" ADD COLUMN "title" text DEFAULT '' NOT NULL;
ALTER TABLE "meetup_plans" ADD COLUMN "location" text DEFAULT '' NOT NULL;
ALTER TABLE "plan_invitees" ADD CONSTRAINT "plan_invitees_plan_id_meetup_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meetup_plans"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plan_invitees" ADD CONSTRAINT "plan_invitees_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "plan_invitees_user_idx" ON "plan_invitees" USING btree ("user_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_meetup_plan_id_meetup_plans_id_fk" FOREIGN KEY ("meetup_plan_id") REFERENCES "public"."meetup_plans"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "busy_blocks_meetup_plan_owner_key" ON "busy_blocks" USING btree ("meetup_plan_id","owner_id");
CREATE INDEX "meetup_plans_created_by_idx" ON "meetup_plans" USING btree ("created_by");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_meetup_link" CHECK (("busy_blocks"."source"::text = 'meetup') = ("busy_blocks"."meetup_plan_id" is not null));
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_title_length" CHECK (length("meetup_plans"."title") <= 80);
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_location_length" CHECK (length("meetup_plans"."location") <= 100);
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_max_duration" CHECK ("meetup_plans"."ends_at" - "meetup_plans"."starts_at" <= interval '12 hours') NOT VALID;
ALTER TABLE "plan_votes" ADD CONSTRAINT "plan_votes_yes_no" CHECK ("plan_votes"."vote" <> 'maybe') NOT VALID;


-- ─── Plans, invités et réponses : lecture seule pour l'app, écriture par fonctions ──────────
-- Avant : on insérait directement dans meetup_plans et plan_votes (n'importe quel membre votait
-- sur n'importe quel plan). Maintenant tout passe par propose_meetup, respond_to_meetup et
-- cancel_meetup (SECURITY DEFINER) qui vérifient : membre du groupe, invité, créateur, limites.
-- Supabase donne par défaut tous les droits sur une nouvelle table à anon et authenticated :
-- on les retire explicitement.
REVOKE ALL ON public.plan_invitees FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.plan_invitees TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.meetup_plans, public.plan_votes FROM authenticated;

DROP POLICY meetup_plans_insert ON public.meetup_plans;

DROP POLICY meetup_plans_update ON public.meetup_plans;

DROP POLICY meetup_plans_delete ON public.meetup_plans;

DROP POLICY plan_votes_insert ON public.plan_votes;

DROP POLICY plan_votes_update ON public.plan_votes;

DROP POLICY plan_votes_delete ON public.plan_votes;

ALTER TABLE public.plan_invitees ENABLE ROW LEVEL SECURITY;

-- Tous les membres du groupe voient qui est invité (comme les plans et les réponses).
CREATE POLICY plan_invitees_select ON public.plan_invitees FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );


-- ─── Blocs « plan » dans l'horaire ─────────────────────────────────────────────────────────
-- Un bloc lié à un plan (meetup_plan_id) n'est créé et retiré que par les fonctions des plans :
-- la personne ne peut pas écrire meetup_plan_id (droits par colonne), ni modifier ou
-- supprimer ce bloc directement (elle refuse le plan à la place). La contrainte
-- busy_blocks_meetup_link empêche aussi d'écrire source = 'meetup' sans plan.
REVOKE INSERT, UPDATE ON public.busy_blocks FROM authenticated;

GRANT INSERT (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from,
  valid_until, source) ON public.busy_blocks TO authenticated;

GRANT UPDATE (title, place_id, start_time, end_time, weekday, valid_from, valid_until)
  ON public.busy_blocks TO authenticated;

DROP POLICY busy_blocks_update ON public.busy_blocks;

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL)
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY busy_blocks_delete ON public.busy_blocks;

CREATE POLICY busy_blocks_delete ON public.busy_blocks FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL);


-- ─── Fonctions ─────────────────────────────────────────────────────────────────────────────
-- Ajoute à l'horaire de `uid` le bloc ponctuel du plan `pid` (heures locales America/Toronto,
-- comme les autres blocs). Même s'il chevauche d'autres blocs. La limite de 1000 blocs
-- (trigger busy_blocks_row_limit, migration 0008) s'applique. Fonction interne : personne ne
-- peut l'appeler directement.
CREATE OR REPLACE FUNCTION public.add_meetup_block(pid uuid, uid uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  plan public.meetup_plans%ROWTYPE;
  local_start timestamp;
  local_end timestamp;
BEGIN
  SELECT * INTO plan FROM public.meetup_plans m WHERE m.id = pid;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  local_start := plan.starts_at AT TIME ZONE 'America/Toronto';
  local_end := plan.ends_at AT TIME ZONE 'America/Toronto';
  INSERT INTO public.busy_blocks (owner_id, title, place_id, start_time, end_time, weekday,
    valid_from, valid_until, source, meetup_plan_id)
  VALUES (
    uid,
    left(coalesce(nullif(trim(plan.title), ''), 'Plan de groupe'), 100),
    plan.place_id,
    local_start::time,
    -- Le plan finit le même jour, ou pile à minuit (propose_meetup le vérifie).
    CASE WHEN local_end::date = local_start::date THEN local_end::time ELSE '24:00'::time END,
    NULL,
    local_start::date,
    local_start::date,
    'meetup',
    pid
  )
  ON CONFLICT (meetup_plan_id, owner_id) DO NOTHING;
END;
$$;

-- Propose un moment au groupe. `p_invitees` nul = tout le groupe (membres actuels) ; sinon les
-- membres choisis (le créateur est toujours ajouté). Le créateur a accepté d'office : le bloc
-- est ajouté à son horaire. Renvoie l'identifiant du plan.
CREATE OR REPLACE FUNCTION public.propose_meetup(
  p_group uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text,
  p_place uuid DEFAULT NULL,
  p_location text DEFAULT '',
  p_invitees uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  clean_title text := trim(coalesce(p_title, ''));
  clean_location text := trim(coalesce(p_location, ''));
  local_start timestamp;
  local_end timestamp;
  invited uuid[];
  pid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  IF p_group IS NULL OR NOT public.is_group_member(p_group) THEN
    RAISE EXCEPTION 'Groupe introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF length(clean_title) = 0 OR length(clean_title) > 80 THEN
    RAISE EXCEPTION 'Le titre doit avoir de 1 à 80 caractères.' USING ERRCODE = '22023';
  END IF;
  IF length(clean_location) > 100 THEN
    RAISE EXCEPTION 'Le lieu doit avoir au plus 100 caractères.' USING ERRCODE = '22023';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'L''heure de fin doit suivre l''heure de début.' USING ERRCODE = '22023';
  END IF;
  IF p_starts_at <= now() THEN
    RAISE EXCEPTION 'Ce moment est déjà commencé ou passé.' USING ERRCODE = '22023';
  END IF;
  IF p_starts_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'Propose un moment dans la prochaine année.' USING ERRCODE = '22023';
  END IF;
  IF p_ends_at - p_starts_at < interval '15 minutes'
    OR p_ends_at - p_starts_at > interval '12 hours' THEN
    RAISE EXCEPTION 'Un plan dure de 15 minutes à 12 heures.' USING ERRCODE = '22023';
  END IF;
  local_start := p_starts_at AT TIME ZONE 'America/Toronto';
  local_end := p_ends_at AT TIME ZONE 'America/Toronto';
  IF local_end::date <> local_start::date
    AND NOT (local_end::date = local_start::date + 1 AND local_end::time = '00:00') THEN
    RAISE EXCEPTION 'Un plan finit le même jour (au plus tard à minuit).' USING ERRCODE = '22023';
  END IF;
  -- Lieu : un lieu d'un membre du groupe, ou un favori de CE groupe (pas d'un autre).
  IF p_place IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.places pl
    JOIN public.group_members gm ON gm.user_id = pl.owner_id AND gm.group_id = p_group
    WHERE pl.id = p_place AND (pl.group_id IS NULL OR pl.group_id = p_group)
  ) THEN
    RAISE EXCEPTION 'Lieu introuvable dans ce groupe.' USING ERRCODE = '22023';
  END IF;

  -- Limites contre l'abus (chaque plan apparaît chez tous les membres du groupe).
  IF (SELECT count(*) FROM public.meetup_plans m
      WHERE m.group_id = p_group AND m.created_by = uid
        AND m.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'Tu as déjà proposé 10 moments dans ce groupe aujourd''hui. Réessaie demain.'
      USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.meetup_plans m
      WHERE m.group_id = p_group AND m.created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'Ce groupe a déjà reçu 30 propositions aujourd''hui. Réessaie demain.'
      USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.meetup_plans m
      WHERE m.group_id = p_group AND m.status = 'proposed' AND m.ends_at > now()) >= 50 THEN
    RAISE EXCEPTION 'Ce groupe a déjà 50 plans à venir. Annule-en avant d''en proposer d''autres.'
      USING ERRCODE = '54000';
  END IF;

  IF p_invitees IS NULL THEN
    SELECT array_agg(gm.user_id) INTO invited
    FROM public.group_members gm WHERE gm.group_id = p_group;
  ELSE
    IF cardinality(p_invitees) > 100 THEN
      RAISE EXCEPTION 'Trop de personnes invitées.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(p_invitees) AS i(id)
      WHERE i.id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_group AND gm.user_id = i.id
      )
    ) THEN
      RAISE EXCEPTION 'On ne peut inviter que des membres du groupe.' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT x) INTO invited FROM unnest(p_invitees || uid) AS u(x);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(invited) AS u(x) WHERE x <> uid) THEN
    RAISE EXCEPTION 'Choisis au moins une autre personne du groupe.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.meetup_plans (group_id, place_id, title, location, starts_at, ends_at,
    status, created_by)
  VALUES (p_group, p_place, clean_title, clean_location, p_starts_at, p_ends_at, 'proposed', uid)
  RETURNING id INTO pid;
  INSERT INTO public.plan_invitees (plan_id, user_id)
  SELECT pid, x FROM unnest(invited) AS u(x);
  INSERT INTO public.plan_votes (plan_id, user_id, vote) VALUES (pid, uid, 'yes');
  PERFORM public.add_meetup_block(pid, uid);
  RETURN pid;
END;
$$;

-- Un invité accepte (le bloc est ajouté à SON horaire, même s'il chevauche) ou refuse (le bloc
-- est retiré). On peut changer d'avis tant que le plan n'est pas fini ni annulé.
CREATE OR REPLACE FUNCTION public.respond_to_meetup(p_plan uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  plan public.meetup_plans%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'Réponse invalide.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO plan FROM public.meetup_plans m WHERE m.id = p_plan FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(plan.group_id) THEN
    RAISE EXCEPTION 'Plan introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_invitees i WHERE i.plan_id = p_plan AND i.user_id = uid
  ) THEN
    RAISE EXCEPTION 'Tu n''es pas invité·e à ce plan.' USING ERRCODE = '42501';
  END IF;
  IF plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'Ce plan a été annulé.' USING ERRCODE = '22023';
  END IF;
  IF plan.ends_at <= now() THEN
    RAISE EXCEPTION 'Ce plan est passé.' USING ERRCODE = '22023';
  END IF;
  IF plan.created_by = uid AND NOT p_accept THEN
    RAISE EXCEPTION 'C''est ta proposition : annule-la plutôt.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.plan_votes (plan_id, user_id, vote)
  VALUES (p_plan, uid, CASE WHEN p_accept THEN 'yes' ELSE 'no' END::public.vote)
  ON CONFLICT (plan_id, user_id) DO UPDATE SET vote = EXCLUDED.vote;
  IF p_accept THEN
    PERFORM public.add_meetup_block(p_plan, uid);
  ELSE
    DELETE FROM public.busy_blocks b WHERE b.meetup_plan_id = p_plan AND b.owner_id = uid;
  END IF;
END;
$$;

-- Le créateur annule son plan : il reste visible (annulé) et son bloc est retiré de l'horaire
-- de tous ceux qui l'avaient accepté.
CREATE OR REPLACE FUNCTION public.cancel_meetup(p_plan uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  plan public.meetup_plans%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO plan FROM public.meetup_plans m WHERE m.id = p_plan FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(plan.group_id) THEN
    RAISE EXCEPTION 'Plan introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF plan.created_by <> uid THEN
    RAISE EXCEPTION 'Seule la personne qui a proposé ce plan peut l''annuler.'
      USING ERRCODE = '42501';
  END IF;
  IF plan.status = 'cancelled' THEN
    RETURN;
  END IF;
  IF plan.ends_at <= now() THEN
    RAISE EXCEPTION 'Ce plan est passé.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.meetup_plans SET status = 'cancelled' WHERE id = p_plan;
  DELETE FROM public.busy_blocks b WHERE b.meetup_plan_id = p_plan;
END;
$$;

-- Quand quelqu'un quitte un groupe (ou en est retiré), il n'est plus invité à ses plans : ses
-- réponses et les blocs de ces plans dans son horaire sont retirés.
CREATE OR REPLACE FUNCTION public.handle_member_left_plans()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.busy_blocks b
  USING public.meetup_plans m
  WHERE b.meetup_plan_id = m.id AND m.group_id = OLD.group_id AND b.owner_id = OLD.user_id;
  DELETE FROM public.plan_votes v
  USING public.meetup_plans m
  WHERE v.plan_id = m.id AND m.group_id = OLD.group_id AND v.user_id = OLD.user_id;
  DELETE FROM public.plan_invitees i
  USING public.meetup_plans m
  WHERE i.plan_id = m.id AND m.group_id = OLD.group_id AND i.user_id = OLD.user_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_group_member_left_plans ON public.group_members;

CREATE TRIGGER on_group_member_left_plans
  AFTER DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_member_left_plans();


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.add_meetup_block(uuid, uuid),
  public.propose_meetup(uuid, timestamptz, timestamptz, text, uuid, text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid),
  public.handle_member_left_plans() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.propose_meetup(uuid, timestamptz, timestamptz, text, uuid, text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid) TO authenticated;

-- ─── Migration 0010_review_plan_privacy ──────────────────────────────────────────────

-- Migration de la revue sécurité (segment 12).
--
-- 1. Caractères de contrôle dans le titre et le lieu d'un plan. Le formulaire les refuse, mais
--    propose_meetup (appelable directement avec la clé anon) les acceptait. Un retour chariot
--    seul (\r) dans le titre permettait d'ajouter des lignes au fichier .ics des autres
--    membres (rappel, invité, deuxième événement…). Mêmes règles que le formulaire ; NOT VALID :
--    les plans existants ne sont pas revérifiés.
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_title_chars" CHECK ("meetup_plans"."title" !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]') NOT VALID;
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_location_chars" CHECK ("meetup_plans"."location" !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]') NOT VALID;


-- 2. Le titre d'un plan sortait de son groupe. Accepter un plan ajoute un bloc portant le
--    titre du plan à l'horaire de la personne. Si elle montre ses titres (hide_block_titles
--    faux), group_busy_blocks montrait ce titre aux membres de ses AUTRES groupes, alors que
--    seuls les membres du groupe du plan peuvent le lire (ex. « Fête surprise pour Dan » vu
--    par Dan dans un autre groupe). Maintenant, dans un autre groupe, ce bloc s'affiche
--    « Occupé ». Rien ne change dans le groupe du plan ni pour les autres blocs.
CREATE OR REPLACE FUNCTION public.group_busy_blocks(gid uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  title text,
  title_hidden boolean,
  place_id uuid,
  start_time time,
  end_time time,
  weekday smallint,
  valid_from date,
  valid_until date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until
  FROM public.busy_blocks b
  JOIN public.group_members m ON m.user_id = b.owner_id AND m.group_id = gid
  JOIN public.profiles p ON p.id = b.owner_id
  LEFT JOIN public.meetup_plans mp ON mp.id = b.meetup_plan_id
  WHERE public.is_group_member(gid)
  ORDER BY b.owner_id, b.weekday NULLS LAST, b.valid_from, b.start_time;
$$;

REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;

COMMIT;
