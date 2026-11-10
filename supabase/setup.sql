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

-- ─── Migration 0011_segment13_study_planner ──────────────────────────────────────────

-- Segment 13 : planificateur d'étude (échéances, séances acceptées dans l'horaire) et
-- préférences d'étude du segment 14. Début généré par drizzle-kit (tables, colonnes,
-- contraintes ; NOT VALID ajouté là où d'anciennes lignes 'study' écrites par l'API REST
-- pourraient ne pas respecter la règle), suite écrite à la main (droits, RLS, triggers,
-- confidentialité des séances dans l'horaire du groupe).
--
-- Les séances PROPOSÉES ne sont jamais écrites : seules les séances acceptées deviennent des
-- blocs busy_blocks (source 'study', deadline_id, movable).
CREATE TYPE "public"."deadline_kind" AS ENUM('exam', 'assignment');
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" "deadline_kind" DEFAULT 'exam' NOT NULL,
	"course" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"estimated_hours" double precision,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_course_not_blank" CHECK (length(trim("deadlines"."course")) > 0),
	CONSTRAINT "deadlines_course_length" CHECK (length("deadlines"."course") <= 80),
	CONSTRAINT "deadlines_course_chars" CHECK ("deadlines"."course" !~ '[\x01-\x1f\x7f-\x9f]'),
	CONSTRAINT "deadlines_estimated_hours_range" CHECK ("deadlines"."estimated_hours" is null or ("deadlines"."estimated_hours" >= 0.5 and "deadlines"."estimated_hours" <= 60 and "deadlines"."estimated_hours" * 2 = floor("deadlines"."estimated_hours" * 2))),
	CONSTRAINT "deadlines_difficulty_range" CHECK ("deadlines"."difficulty" between 1 and 3),
	CONSTRAINT "deadlines_due_at_range" CHECK ("deadlines"."due_at" >= '2020-01-01' and "deadlines"."due_at" < '2100-01-01')
);

CREATE TABLE "study_preferences" (
	"owner_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"min_session_minutes" smallint DEFAULT 45 NOT NULL,
	"max_session_minutes" smallint DEFAULT 120 NOT NULL,
	"max_minutes_per_day" smallint DEFAULT 180 NOT NULL,
	"break_minutes" smallint DEFAULT 15 NOT NULL,
	"study_start" time DEFAULT '08:00' NOT NULL,
	"study_end" time DEFAULT '22:00' NOT NULL,
	"eve_cutoff" time DEFAULT '21:00',
	"keep_free_percent" smallint DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_preferences_min_session" CHECK ("study_preferences"."min_session_minutes" between 30 and 120 and "study_preferences"."min_session_minutes" % 15 = 0),
	CONSTRAINT "study_preferences_max_session" CHECK ("study_preferences"."max_session_minutes" between "study_preferences"."min_session_minutes" and 240 and "study_preferences"."max_session_minutes" % 15 = 0),
	CONSTRAINT "study_preferences_max_per_day" CHECK ("study_preferences"."max_minutes_per_day" between "study_preferences"."min_session_minutes" and 600 and "study_preferences"."max_minutes_per_day" % 15 = 0),
	CONSTRAINT "study_preferences_break" CHECK ("study_preferences"."break_minutes" between 0 and 60),
	CONSTRAINT "study_preferences_hours" CHECK ("study_preferences"."study_end" - "study_preferences"."study_start" >= make_interval(mins => "study_preferences"."min_session_minutes")),
	CONSTRAINT "study_preferences_keep_free" CHECK ("study_preferences"."keep_free_percent" between 0 and 90)
);

ALTER TABLE "busy_blocks" ADD COLUMN "deadline_id" uuid;
ALTER TABLE "busy_blocks" ADD COLUMN "movable" boolean DEFAULT false NOT NULL;
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "study_preferences" ADD CONSTRAINT "study_preferences_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "deadlines_owner_idx" ON "deadlines" USING btree ("owner_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "busy_blocks_deadline_idx" ON "busy_blocks" USING btree ("deadline_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_study_link" CHECK (("busy_blocks"."source"::text = 'study') = ("busy_blocks"."deadline_id" is not null)) NOT VALID;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_study_one_off" CHECK ("busy_blocks"."source"::text <> 'study' or "busy_blocks"."weekday" is null) NOT VALID;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_movable_study" CHECK (not "busy_blocks"."movable" or "busy_blocks"."source"::text = 'study');


-- ─── Échéances et préférences : visibles et modifiables seulement par leur propriétaire ────
-- Supabase donne par défaut tous les droits sur une nouvelle table à anon et authenticated :
-- on les retire, puis on ne rend que le nécessaire (droits par colonne : owner_id et id ne se
-- modifient pas).
REVOKE ALL ON public.deadlines, public.study_preferences FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.deadlines, public.study_preferences TO authenticated;

GRANT INSERT (owner_id, kind, course, due_at, estimated_hours, difficulty)
  ON public.deadlines TO authenticated;

GRANT UPDATE (kind, course, due_at, estimated_hours, difficulty) ON public.deadlines TO authenticated;

GRANT INSERT (owner_id, min_session_minutes, max_session_minutes, max_minutes_per_day,
  break_minutes, study_start, study_end, eve_cutoff, keep_free_percent)
  ON public.study_preferences TO authenticated;

GRANT UPDATE (min_session_minutes, max_session_minutes, max_minutes_per_day, break_minutes,
  study_start, study_end, eve_cutoff, keep_free_percent)
  ON public.study_preferences TO authenticated;

ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.study_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY deadlines_select ON public.deadlines FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY deadlines_insert ON public.deadlines FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY deadlines_update ON public.deadlines FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY deadlines_delete ON public.deadlines FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY study_preferences_select ON public.study_preferences FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY study_preferences_insert ON public.study_preferences FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY study_preferences_update ON public.study_preferences FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY study_preferences_delete ON public.study_preferences FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP TRIGGER IF EXISTS study_preferences_touch ON public.study_preferences;

CREATE TRIGGER study_preferences_touch
  BEFORE UPDATE ON public.study_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─── Limites des échéances ─────────────────────────────────────────────────────────────────
-- Comme les lieux et les blocs (0008) : la clé anon est publique, on pourrait sinon créer des
-- milliers d'échéances par l'API REST (chacune est lue à chaque planification). La date est
-- revérifiée seulement quand elle change : on peut corriger le nom d'un examen passé.
CREATE OR REPLACE FUNCTION public.enforce_deadline_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND (SELECT count(*) FROM public.deadlines d WHERE d.owner_id = NEW.owner_id) >= 100 THEN
    RAISE EXCEPTION 'Trop d''examens et de travaux (100 au maximum). Supprime les anciens.'
      USING ERRCODE = '54000';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.due_at IS DISTINCT FROM OLD.due_at)
    AND (NEW.due_at < now() - interval '1 day' OR NEW.due_at > now() + interval '366 days') THEN
    RAISE EXCEPTION 'La date doit être dans l''année qui vient.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deadlines_limits ON public.deadlines;

CREATE TRIGGER deadlines_limits
  BEFORE INSERT OR UPDATE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_deadline_limits();


-- ─── Séances acceptées dans busy_blocks ────────────────────────────────────────────────────
-- deadline_id ne peut pointer que vers une échéance de la MÊME personne. La politique
-- d'insertion ne suffit pas : la clé étrangère est vérifiée sans RLS, on pourrait donc viser
-- l'échéance d'un autre (et, par la cascade, voir son bloc disparaître quand il la supprime).
CREATE OR REPLACE FUNCTION public.check_block_deadline_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.deadline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.deadlines d
    WHERE d.id = NEW.deadline_id AND d.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Échéance introuvable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS busy_blocks_deadline_owner ON public.busy_blocks;

CREATE TRIGGER busy_blocks_deadline_owner
  BEFORE INSERT OR UPDATE OF deadline_id, owner_id ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.check_block_deadline_owner();

-- On écrit deadline_id et movable en créant une séance ; ensuite seul movable se modifie.
GRANT INSERT (deadline_id, movable) ON public.busy_blocks TO authenticated;

GRANT UPDATE (movable) ON public.busy_blocks TO authenticated;


-- ─── Confidentialité : une séance d'étude est toujours « Occupé » pour les autres ─────────
-- Le titre d'une séance contient le nom du cours, et les échéances sont privées : même si la
-- personne montre ses titres (hide_block_titles faux), les membres de ses groupes voient
-- « Occupé ». Le reste est inchangé (migration 0010).
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
        OR NOT (p.hide_block_titles OR b.source::text = 'study'
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text = 'study' OR coalesce(mp.group_id <> gid, false)),
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


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.enforce_deadline_limits(),
  public.check_block_deadline_owner() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;

-- ─── Migration 0012_segment18_availability_slots ─────────────────────────────────────

-- Segment 18 (bonus) : disponibilités ponctuelles (« ce samedi, je suis libre de 13 h à
-- 18 h »). Début généré par drizzle-kit (table, contraintes), suite écrite à la main (droits,
-- RLS, limites, lecture par les membres des groupes).
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"day" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_slots_time_order" CHECK ("availability_slots"."end_time" - "availability_slots"."start_time" >= interval '15 minutes'),
	CONSTRAINT "availability_slots_day_range" CHECK ("availability_slots"."day" >= '2020-01-01' and "availability_slots"."day" < '2100-01-01'),
	CONSTRAINT "availability_slots_note_length" CHECK (length("availability_slots"."note") <= 60),
	CONSTRAINT "availability_slots_note_chars" CHECK ("availability_slots"."note" !~ '[\x01-\x1f\x7f-\x9f]')
);

ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "availability_slots_owner_day_idx" ON "availability_slots" USING btree ("owner_id","day");


-- ─── Droits et RLS : seulement la personne elle-même ──────────────────────────────────────
-- Supabase donne par défaut tous les droits sur une nouvelle table à anon et authenticated :
-- on les retire, puis on ne rend que le nécessaire (droits par colonne : id, owner_id et
-- created_at ne se modifient pas).
REVOKE ALL ON public.availability_slots FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.availability_slots TO authenticated;

GRANT INSERT (owner_id, day, start_time, end_time, note) ON public.availability_slots TO authenticated;

GRANT UPDATE (day, start_time, end_time, note) ON public.availability_slots TO authenticated;

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_slots_select ON public.availability_slots FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_insert ON public.availability_slots FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_update ON public.availability_slots FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_delete ON public.availability_slots FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- ─── Limites ───────────────────────────────────────────────────────────────────────────────
-- Comme les blocs et les échéances : la clé anon est publique, on pourrait sinon créer des
-- milliers de lignes par l'API REST (elles sont lues à chaque recherche des membres des
-- groupes). Seules les disponibilités à venir comptent (les passées ne sont plus lues par
-- group_availability_slots et ne bloquent pas). Le jour est revérifié seulement quand il change.
CREATE OR REPLACE FUNCTION public.enforce_availability_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    SELECT count(*) FROM public.availability_slots a
    WHERE a.owner_id = NEW.owner_id AND a.day >= current_date - 1
  ) >= 100 THEN
    RAISE EXCEPTION 'Trop de disponibilités (100 au maximum). Supprime les anciennes.'
      USING ERRCODE = '54000';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.day IS DISTINCT FROM OLD.day)
    AND (NEW.day < current_date - 1 OR NEW.day > current_date + 366) THEN
    RAISE EXCEPTION 'Le jour doit être dans l''année qui vient.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS availability_slots_limits ON public.availability_slots;

CREATE TRIGGER availability_slots_limits
  BEFORE INSERT OR UPDATE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_availability_limits();


-- ─── Lecture par les membres d'un groupe ──────────────────────────────────────────────────
-- Comme group_busy_blocks : seulement pour un membre du groupe, seulement les lignes des
-- membres, à partir d'hier. Jamais la note (privée).
CREATE OR REPLACE FUNCTION public.group_availability_slots(gid uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  day date,
  start_time time,
  end_time time
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.owner_id, a.day, a.start_time, a.end_time
  FROM public.availability_slots a
  JOIN public.group_members m ON m.user_id = a.owner_id AND m.group_id = gid
  WHERE public.is_group_member(gid) AND a.day >= current_date - 1
  ORDER BY a.owner_id, a.day, a.start_time;
$$;


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.enforce_availability_limits()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.group_availability_slots(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_availability_slots(uuid) TO authenticated;

-- ─── Migration 0013_review_availability_limit ────────────────────────────────────────

-- Migration de la revue sécurité (segment 18).
--
-- 18.1. La limite de 100 disponibilités à venir par personne n'était vérifiée qu'à l'ajout.
--       Une disponibilité passée ne compte plus ; en changeant son jour (UPDATE, permis par
--       l'API REST), on la ramenait dans l'année qui vient sans passer par la limite. En
--       ajoutant 100 disponibilités par jour puis en les ramenant, on en gardait autant qu'on
--       voulait, et chaque membre de ses groupes les chargeait (page du groupe, « Je suis libre
--       maintenant »). Maintenant, ramener une disponibilité passée compte comme un ajout.
--       Rien d'autre ne change : modifier une disponibilité à venir, ou la note d'une
--       disponibilité passée, reste permis même à 100.
CREATE OR REPLACE FUNCTION public.enforce_availability_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR (OLD.day < current_date - 1 AND NEW.day >= current_date - 1)) AND (
    SELECT count(*) FROM public.availability_slots a
    WHERE a.owner_id = NEW.owner_id AND a.day >= current_date - 1
  ) >= 100 THEN
    RAISE EXCEPTION 'Trop de disponibilités (100 au maximum). Supprime les anciennes.'
      USING ERRCODE = '54000';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.day IS DISTINCT FROM OLD.day)
    AND (NEW.day < current_date - 1 OR NEW.day > current_date + 366) THEN
    RAISE EXCEPTION 'Le jour doit être dans l''année qui vient.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_availability_limits()
  FROM PUBLIC, anon, authenticated;

-- ─── Migration 0014_outlook_connector ────────────────────────────────────────────────

ALTER TYPE "public"."block_source" ADD VALUE 'outlook';
CREATE TABLE "outlook_connections" (
	"owner_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"account_email" text DEFAULT '' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"calendar_id" text,
	"calendar_name" text DEFAULT '' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text DEFAULT '' NOT NULL,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlook_connections_email_length" CHECK (length("outlook_connections"."account_email") <= 320),
	CONSTRAINT "outlook_connections_token_length" CHECK (length("outlook_connections"."refresh_token_enc") between 1 and 16000),
	CONSTRAINT "outlook_connections_calendar_id_length" CHECK ("outlook_connections"."calendar_id" is null or length("outlook_connections"."calendar_id") between 1 and 1024),
	CONSTRAINT "outlook_connections_calendar_name_length" CHECK (length("outlook_connections"."calendar_name") <= 255),
	CONSTRAINT "outlook_connections_error_length" CHECK (length("outlook_connections"."last_sync_error") <= 300)
);

ALTER TABLE "outlook_connections" ADD CONSTRAINT "outlook_connections_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_outlook_one_off" CHECK ("busy_blocks"."source"::text <> 'outlook' or ("busy_blocks"."weekday" is null and "busy_blocks"."place_id" is null));

-- ─── Connecteur Outlook : droits et RLS ───────────────────────────────────────────────────
-- Une connexion Outlook n'est visible et modifiable que par la personne elle-même. Les membres
-- de ses groupes ne voient JAMAIS cette table : seulement les blocs « Occupé » qui en sont
-- tirés (busy_blocks, source 'outlook'). Le jeton est chiffré par le serveur de l'app (clé
-- OUTLOOK_TOKEN_KEY, jamais dans la BD) : même lu par l'API REST, il est inutilisable.
REVOKE ALL ON public.outlook_connections FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.outlook_connections TO authenticated;

GRANT INSERT (owner_id, account_email, refresh_token_enc, calendar_id, calendar_name)
  ON public.outlook_connections TO authenticated;

GRANT UPDATE (account_email, refresh_token_enc, calendar_id, calendar_name, last_attempt_at,
  last_synced_at, last_sync_error, sync_started_at) ON public.outlook_connections TO authenticated;

ALTER TABLE public.outlook_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY outlook_connections_select ON public.outlook_connections FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_insert ON public.outlook_connections FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_update ON public.outlook_connections FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_delete ON public.outlook_connections FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- ─── Blocs Outlook : lecture seule pour la personne ───────────────────────────────────────
-- Les blocs 'outlook' ne s'écrivent que par replace_outlook_blocks et ne se retirent que par
-- elle ou disconnect_outlook : la personne ne peut pas les modifier ni les supprimer un à un
-- (ils reviendraient à la synchro suivante). Comparaison en texte : la valeur 'outlook' est
-- ajoutée dans la même transaction.
DROP POLICY busy_blocks_update ON public.busy_blocks;

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL AND source::text <> 'outlook')
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
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL AND source::text <> 'outlook');

-- On ne peut pas non plus créer un bloc 'outlook' à la main (seulement par la fonction).
DROP POLICY busy_blocks_insert ON public.busy_blocks;

CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND source::text <> 'outlook'
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );


-- ─── Fonctions ─────────────────────────────────────────────────────────────────────────────
-- Remplace TOUS les blocs Outlook de la personne connectée par `p_blocks` (tableau JSON de
-- {"day": "yyyy-MM-dd", "start": "HH:mm", "end": "HH:mm"}), en une transaction : si un bloc
-- est refusé, les anciens restent. Titre fixe « Outlook », aucun lieu : on ne garde jamais le
-- titre, le lieu ni les participants des événements. Les contraintes de busy_blocks et la
-- limite de 1000 blocs (trigger busy_blocks_row_limit) s'appliquent.
CREATE OR REPLACE FUNCTION public.replace_outlook_blocks(p_blocks jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outlook_connections c WHERE c.owner_id = uid) THEN
    RAISE EXCEPTION 'Outlook n''est pas connecté.' USING ERRCODE = '42501';
  END IF;
  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN
    RAISE EXCEPTION 'Blocs Outlook invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_blocks) > 500 THEN
    RAISE EXCEPTION 'Trop d''événements Outlook (500 au maximum)' USING ERRCODE = '54000';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.owner_id = uid AND b.source::text = 'outlook';
  INSERT INTO public.busy_blocks (owner_id, title, place_id, start_time, end_time, weekday,
    valid_from, valid_until, source)
  SELECT uid, 'Outlook', NULL, (e->>'start')::time, (e->>'end')::time, NULL,
    (e->>'day')::date, NULL, 'outlook'::public.block_source
  FROM jsonb_array_elements(p_blocks) AS e;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Déconnexion : retire les blocs Outlook ET la connexion (le jeton chiffré), en une fois.
CREATE OR REPLACE FUNCTION public.disconnect_outlook()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.owner_id = uid AND b.source::text = 'outlook';
  DELETE FROM public.outlook_connections c WHERE c.owner_id = uid;
END;
$$;

-- Réserve une synchronisation pour la personne connectée et renvoie de quoi la faire.
-- `p_min_minutes` : délai minimal depuis le dernier essai (15 automatique, 1 bouton), au
-- moins 1. Statut : 'none' (pas connecté), 'recent' (trop tôt), 'busy' (une autre synchro
-- est en cours depuis moins de 2 min) ou 'ok' (réservée : le verrou est posé).
CREATE OR REPLACE FUNCTION public.claim_outlook_sync(p_min_minutes integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  c public.outlook_connections;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.outlook_connections oc WHERE oc.owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  IF c.sync_started_at IS NOT NULL AND c.sync_started_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  IF c.last_attempt_at IS NOT NULL
    AND c.last_attempt_at > now() - make_interval(mins => greatest(coalesce(p_min_minutes, 15), 1)) THEN
    RETURN jsonb_build_object('status', 'recent');
  END IF;
  UPDATE public.outlook_connections oc
    SET sync_started_at = now(), last_attempt_at = now()
    WHERE oc.owner_id = uid;
  RETURN jsonb_build_object('status', 'ok', 'refresh_token_enc', c.refresh_token_enc,
    'calendar_id', c.calendar_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_outlook_blocks(jsonb), public.disconnect_outlook(),
  public.claim_outlook_sync(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.replace_outlook_blocks(jsonb), public.disconnect_outlook(),
  public.claim_outlook_sync(integer) TO authenticated;


-- ─── Confidentialité : un bloc Outlook est toujours « Occupé » pour les autres ────────────
-- Même si la personne montre ses titres (hide_block_titles faux). Le reste est inchangé
-- (migration 0011).
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
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
        OR coalesce(mp.group_id <> gid, false)),
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

-- ─── Migration 0015_custom_recurrence ────────────────────────────────────────────────

ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_validity_span";
ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_one_off_has_day";
ALTER TABLE "busy_blocks" ADD COLUMN "repeat_unit" text;
ALTER TABLE "busy_blocks" ADD COLUMN "repeat_every" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_every_range" CHECK ("busy_blocks"."repeat_every" between 1 and 99);
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_shape" CHECK (("busy_blocks"."repeat_unit" is null and "busy_blocks"."repeat_every" = 1) or ("busy_blocks"."repeat_unit" is not null and (("busy_blocks"."repeat_unit" = 'week' and "busy_blocks"."weekday" is not null and "busy_blocks"."valid_from" is not null) or ("busy_blocks"."repeat_unit" in ('day', 'month', 'year') and "busy_blocks"."weekday" is null and "busy_blocks"."valid_from" is not null))));
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_manual" CHECK ("busy_blocks"."repeat_unit" is null or "busy_blocks"."source"::text = 'manual');
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_validity_span" CHECK ("busy_blocks"."valid_from" is null or "busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" - "busy_blocks"."valid_from" < (case when "busy_blocks"."repeat_unit" is null then 366 else 3660 end)) NOT VALID;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_one_off_has_day" CHECK ("busy_blocks"."weekday" is not null or "busy_blocks"."repeat_unit" is not null or ("busy_blocks"."valid_from" is not null and ("busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" = "busy_blocks"."valid_from")));

-- ─── Story 2 : répétition personnalisée (« tous les X jours / semaines / mois / ans ») ────
-- Droits par colonne (migration 0009) : la personne peut écrire la répétition de ses blocs.
GRANT INSERT (repeat_unit, repeat_every), UPDATE (repeat_unit, repeat_every)
  ON public.busy_blocks TO authenticated;


-- L'horaire du groupe renvoie aussi la répétition (sinon un bloc « toutes les 2 semaines »
-- compterait chaque semaine pour les autres). Le type de retour change : on recrée la
-- fonction. Le reste est inchangé (migration 0014).
DROP FUNCTION public.group_busy_blocks(uuid);

CREATE FUNCTION public.group_busy_blocks(gid uuid)
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
  valid_until date,
  repeat_unit text,
  repeat_every smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
        OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until,
    b.repeat_unit,
    b.repeat_every
  FROM public.busy_blocks b
  JOIN public.group_members m ON m.user_id = b.owner_id AND m.group_id = gid
  JOIN public.profiles p ON p.id = b.owner_id
  LEFT JOIN public.meetup_plans mp ON mp.id = b.meetup_plan_id
  WHERE public.is_group_member(gid)
  ORDER BY b.owner_id, b.weekday NULLS LAST, b.valid_from, b.start_time;
$$;

REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;

-- ─── Migration 0016_review_repeat_weight ─────────────────────────────────────────────

-- Migration de la revue sécurité (story 2, répétition personnalisée).
--
-- 1. Un bloc « tous les jours » compte pour 7 dans la limite de 1000 blocs (migration 0008).
--    La limite comptait les lignes. Un bloc hebdomadaire revient une fois par semaine, mais un
--    bloc « tous les jours » revient 7 fois : 1000 blocs « tous les jours » donnaient
--    7000 blocs par semaine à déplier pour chaque membre de ses groupes (recherche de moments,
--    « Je suis libre maintenant », 2,6 s → 6,6 s). Maintenant, un bloc « tous les X jours »
--    compte pour ceil(7 / X) : au plus 1000 blocs par semaine, comme avant. Sans bloc
--    « tous les jours », rien ne change (tous les poids valent 1).
CREATE OR REPLACE FUNCTION public.busy_block_weight(unit text, every integer)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN unit = 'day' THEN ceil(7.0 / greatest(coalesce(every, 1), 1))::integer ELSE 1 END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_repeat_weight()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  w integer := public.busy_block_weight(NEW.repeat_unit, NEW.repeat_every);
BEGIN
  IF TG_OP = 'UPDATE' AND w <= public.busy_block_weight(OLD.repeat_unit, OLD.repeat_every) THEN
    RETURN NEW;
  END IF;
  IF w + (
    SELECT coalesce(sum(public.busy_block_weight(b.repeat_unit, b.repeat_every)), 0)
    FROM public.busy_blocks b
    WHERE b.owner_id = NEW.owner_id AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
  ) > 1000 THEN
    RAISE EXCEPTION 'Trop de blocs dans l''horaire (1000 au maximum ; un bloc « tous les jours » compte pour 7)'
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS busy_blocks_repeat_weight ON public.busy_blocks;

CREATE TRIGGER busy_blocks_repeat_weight
  BEFORE INSERT OR UPDATE OF repeat_unit, repeat_every ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_repeat_weight();

REVOKE EXECUTE ON FUNCTION public.enforce_repeat_weight(), public.busy_block_weight(text, integer)
  FROM PUBLIC, anon, authenticated;

-- ─── Migration 0017_subscribed_calendars ─────────────────────────────────────────────

ALTER TYPE "public"."block_source" ADD VALUE 'subscription';
CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"outlook_calendar_id" text,
	"counts_as_busy" boolean NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text DEFAULT '' NOT NULL,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_subscriptions_kind" CHECK ("calendar_subscriptions"."kind" in ('ics', 'outlook')),
	CONSTRAINT "calendar_subscriptions_shape" CHECK (("calendar_subscriptions"."kind" = 'ics' and "calendar_subscriptions"."url" is not null and "calendar_subscriptions"."outlook_calendar_id" is null) or ("calendar_subscriptions"."kind" = 'outlook' and "calendar_subscriptions"."url" is null and "calendar_subscriptions"."outlook_calendar_id" is not null)),
	CONSTRAINT "calendar_subscriptions_url_format" CHECK ("calendar_subscriptions"."url" is null or (length("calendar_subscriptions"."url") <= 2000 and "calendar_subscriptions"."url" ~ '^https?://')),
	CONSTRAINT "calendar_subscriptions_outlook_id_length" CHECK ("calendar_subscriptions"."outlook_calendar_id" is null or length("calendar_subscriptions"."outlook_calendar_id") between 1 and 1024),
	CONSTRAINT "calendar_subscriptions_name_length" CHECK (length("calendar_subscriptions"."name") between 1 and 100),
	CONSTRAINT "calendar_subscriptions_error_length" CHECK (length("calendar_subscriptions"."last_sync_error") <= 300)
);

CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"weekday" smallint,
	"valid_from" date NOT NULL,
	"valid_until" date,
	CONSTRAINT "subscription_events_time_order" CHECK ("subscription_events"."end_time" > "subscription_events"."start_time"),
	CONSTRAINT "subscription_events_weekday_range" CHECK ("subscription_events"."weekday" is null or "subscription_events"."weekday" between 1 and 7),
	CONSTRAINT "subscription_events_validity" CHECK ("subscription_events"."valid_until" is null or ("subscription_events"."valid_until" >= "subscription_events"."valid_from" and "subscription_events"."valid_until" - "subscription_events"."valid_from" < 366)),
	CONSTRAINT "subscription_events_one_off" CHECK ("subscription_events"."weekday" is not null or "subscription_events"."valid_until" is null or "subscription_events"."valid_until" = "subscription_events"."valid_from"),
	CONSTRAINT "subscription_events_title_length" CHECK (length("subscription_events"."title") <= 100)
);

ALTER TABLE "busy_blocks" ADD COLUMN "subscription_id" uuid;
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_calendar_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."calendar_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "calendar_subscriptions_owner_idx" ON "calendar_subscriptions" USING btree ("owner_id");
CREATE UNIQUE INDEX "calendar_subscriptions_owner_url_key" ON "calendar_subscriptions" USING btree ("owner_id","url");
CREATE UNIQUE INDEX "calendar_subscriptions_owner_outlook_key" ON "calendar_subscriptions" USING btree ("owner_id","outlook_calendar_id");
CREATE INDEX "subscription_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id");
CREATE INDEX "subscription_events_owner_idx" ON "subscription_events" USING btree ("owner_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_id_calendar_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."calendar_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "busy_blocks_subscription_idx" ON "busy_blocks" USING btree ("subscription_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_link" CHECK (("busy_blocks"."source"::text = 'subscription') = ("busy_blocks"."subscription_id" is not null));
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_no_place" CHECK ("busy_blocks"."source"::text <> 'subscription' or "busy_blocks"."place_id" is null);

-- ─── Story 3 : calendriers en ligne abonnés ─────────────────────────────────────────────
-- Un calendrier abonné (lien iCalendar ou calendrier du compte Outlook) et ses événements ne
-- sont visibles que par la personne. Si elle a choisi « compte comme occupé », les
-- événements sont aussi copiés dans busy_blocks (source 'subscription') : les membres de ses
-- groupes n'y voient que « Occupé ». Sinon, ils restent dans subscription_events, affichés
-- dans son horaire seulement, et ne bloquent rien.
--
-- Personne ne modifie un abonnement directement : on l'ajoute (INSERT), on le retire
-- (DELETE : ses événements et ses blocs partent avec lui), et tout le reste passe par les
-- fonctions ci-dessous (synchro, « compte comme occupé »). L'adresse n'est lue que par le
-- serveur de l'app, qui la vérifie avant chaque téléchargement (pas d'adresse interne).
REVOKE ALL ON public.calendar_subscriptions, public.subscription_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.calendar_subscriptions TO authenticated;

GRANT INSERT (owner_id, kind, name, url, outlook_calendar_id, counts_as_busy)
  ON public.calendar_subscriptions TO authenticated;

GRANT SELECT ON public.subscription_events TO authenticated;

ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_subscriptions_select ON public.calendar_subscriptions FOR SELECT
  TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE POLICY calendar_subscriptions_insert ON public.calendar_subscriptions FOR INSERT
  TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY calendar_subscriptions_delete ON public.calendar_subscriptions FOR DELETE
  TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE POLICY subscription_events_select ON public.subscription_events FOR SELECT
  TO authenticated USING (owner_id = (SELECT auth.uid()));


-- Au plus 10 calendriers abonnés par personne.
CREATE OR REPLACE FUNCTION public.enforce_subscription_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.calendar_subscriptions s WHERE s.owner_id = NEW.owner_id) >= 10 THEN
    RAISE EXCEPTION 'Trop de calendriers abonnés (10 au maximum)' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_subscriptions_limit
  BEFORE INSERT ON public.calendar_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();

REVOKE EXECUTE ON FUNCTION public.enforce_subscription_limit() FROM PUBLIC, anon, authenticated;


-- ─── Blocs d'abonnement : lecture seule pour la personne (comme Outlook) ──────────────────
-- Ils ne s'écrivent que par les fonctions ci-dessous et partent avec leur abonnement.
DROP POLICY busy_blocks_update ON public.busy_blocks;

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND source::text NOT IN ('outlook', 'subscription')
  )
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
  USING (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND source::text NOT IN ('outlook', 'subscription')
  );

DROP POLICY busy_blocks_insert ON public.busy_blocks;

CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND source::text NOT IN ('outlook', 'subscription')
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );


-- ─── Fonctions ─────────────────────────────────────────────────────────────────────────────
-- Copie (ou retire) les événements d'un abonnement dans busy_blocks selon counts_as_busy.
-- Interne : appelée seulement par les fonctions ci-dessous.
CREATE OR REPLACE FUNCTION public.mirror_subscription_blocks(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.busy_blocks b WHERE b.subscription_id = p_id;
  INSERT INTO public.busy_blocks (owner_id, title, place_id, start_time, end_time, weekday,
    valid_from, valid_until, source, subscription_id)
  SELECT e.owner_id, e.title, NULL, e.start_time, e.end_time, e.weekday, e.valid_from,
    e.valid_until, 'subscription'::public.block_source, e.subscription_id
  FROM public.subscription_events e
  JOIN public.calendar_subscriptions s ON s.id = e.subscription_id
  WHERE e.subscription_id = p_id AND s.counts_as_busy
  ORDER BY e.valid_from, e.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mirror_subscription_blocks(uuid) FROM PUBLIC, anon, authenticated;


-- Réserve la synchronisation des abonnements de la personne connectée qui sont dus : dernier
-- essai il y a au moins `p_min_minutes` (360 automatique, 2 bouton ; au moins 1), et pas de
-- synchro en cours depuis moins de 2 min. `p_id` : un seul abonnement (bouton). Au plus 5 à
-- la fois. Renvoie un tableau JSON [{id, kind, url, outlook_calendar_id}] (vide : rien à faire).
CREATE OR REPLACE FUNCTION public.claim_subscription_syncs(p_min_minutes integer, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  WITH due AS (
    SELECT s.id FROM public.calendar_subscriptions s
    WHERE s.owner_id = uid
      AND (p_id IS NULL OR s.id = p_id)
      AND (s.sync_started_at IS NULL OR s.sync_started_at <= now() - interval '2 minutes')
      AND (s.last_attempt_at IS NULL OR s.last_attempt_at
        <= now() - make_interval(mins => greatest(coalesce(p_min_minutes, 360), 1)))
    ORDER BY s.last_attempt_at NULLS FIRST, s.created_at
    LIMIT 5
    FOR UPDATE
  ), claimed AS (
    UPDATE public.calendar_subscriptions s
      SET sync_started_at = now(), last_attempt_at = now()
      FROM due WHERE s.id = due.id
      RETURNING s.id, s.kind, s.url, s.outlook_calendar_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'url', c.url,
      'outlook_calendar_id', c.outlook_calendar_id)), '[]'::jsonb)
    INTO result FROM claimed c;
  RETURN result;
END;
$$;


-- Remplace les événements d'un abonnement de la personne par `p_events` (tableau JSON de
-- {"title", "start": "HH:mm", "end": "HH:mm", "weekday": 1-7 ou null, "from": "yyyy-MM-dd",
-- "until": "yyyy-MM-dd" ou null}), en une transaction : si un événement est refusé (ou si la
-- limite de 1000 blocs est dépassée), l'ancienne version reste. Note la synchro réussie.
CREATE OR REPLACE FUNCTION public.replace_subscription_events(p_id uuid, p_events jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.calendar_subscriptions s
    WHERE s.id = p_id AND s.owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendrier abonné introuvable.' USING ERRCODE = '42501';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'Événements invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_events) > 300 THEN
    RAISE EXCEPTION 'Trop d''événements dans ce calendrier (300 au maximum)' USING ERRCODE = '54000';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.subscription_id = p_id;
  DELETE FROM public.subscription_events e WHERE e.subscription_id = p_id;
  INSERT INTO public.subscription_events (subscription_id, owner_id, title, start_time,
    end_time, weekday, valid_from, valid_until)
  SELECT p_id, uid, left(coalesce(e->>'title', ''), 100), (e->>'start')::time,
    (e->>'end')::time, (e->>'weekday')::smallint, (e->>'from')::date, (e->>'until')::date
  FROM jsonb_array_elements(p_events) AS e;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.mirror_subscription_blocks(p_id);
  UPDATE public.calendar_subscriptions s
    SET last_synced_at = now(), last_sync_error = '', sync_started_at = NULL,
      last_attempt_at = coalesce(s.last_attempt_at, now())
    WHERE s.id = p_id;
  RETURN n;
END;
$$;


-- Synchro ratée (lien brisé, calendrier illisible…) : on garde la dernière version connue et
-- on note l'erreur, affichée à la personne.
CREATE OR REPLACE FUNCTION public.fail_subscription_sync(p_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_subscriptions s
    SET last_sync_error = left(coalesce(nullif(p_error, ''), 'Synchronisation impossible.'), 300),
      sync_started_at = NULL
    WHERE s.id = p_id AND s.owner_id = uid;
END;
$$;


-- « Compte comme occupé » : change le choix et ajoute ou retire tout de suite les blocs.
CREATE OR REPLACE FUNCTION public.set_subscription_busy(p_id uuid, p_busy boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  IF p_busy IS NULL THEN
    RAISE EXCEPTION 'Choix invalide.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.calendar_subscriptions s SET counts_as_busy = p_busy
    WHERE s.id = p_id AND s.owner_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendrier abonné introuvable.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.mirror_subscription_blocks(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_subscription_syncs(integer, uuid),
  public.replace_subscription_events(uuid, jsonb), public.fail_subscription_sync(uuid, text),
  public.set_subscription_busy(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_subscription_syncs(integer, uuid),
  public.replace_subscription_events(uuid, jsonb), public.fail_subscription_sync(uuid, text),
  public.set_subscription_busy(uuid, boolean) TO authenticated;


-- Déconnecter Outlook retire aussi les calendriers abonnés lus par Outlook (et leurs blocs).
-- Le reste est inchangé (migration 0014).
CREATE OR REPLACE FUNCTION public.disconnect_outlook()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.owner_id = uid AND b.source::text = 'outlook';
  DELETE FROM public.calendar_subscriptions s WHERE s.owner_id = uid AND s.kind = 'outlook';
  DELETE FROM public.outlook_connections c WHERE c.owner_id = uid;
END;
$$;


-- ─── Confidentialité : un bloc d'abonnement est toujours « Occupé » pour les autres ───────
-- Même si la personne montre ses titres. Le reste est inchangé (migration 0015).
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
  valid_until date,
  repeat_unit text,
  repeat_every smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
        OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until,
    b.repeat_unit,
    b.repeat_every
  FROM public.busy_blocks b
  JOIN public.group_members m ON m.user_id = b.owner_id AND m.group_id = gid
  JOIN public.profiles p ON p.id = b.owner_id
  LEFT JOIN public.meetup_plans mp ON mp.id = b.meetup_plan_id
  WHERE public.is_group_member(gid)
  ORDER BY b.owner_id, b.weekday NULLS LAST, b.valid_from, b.start_time;
$$;

REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;

-- ─── Migration 0018_story5_recurring_plans ───────────────────────────────────────────

-- Story 5 : plans récurrents partagés (« le gym tous les 2 jours avec Sam »). Début généré par
-- drizzle-kit (colonnes de répétition des plans ; les blocs « plan » peuvent maintenant se
-- répéter), suite écrite à la main (fonctions).
ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_repeat_manual";
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_unit" text;
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_every" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_until" date;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_manual" CHECK ("busy_blocks"."repeat_unit" is null or "busy_blocks"."source"::text in ('manual', 'meetup'));
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_repeat_every_range" CHECK ("meetup_plans"."repeat_every" between 1 and 99);
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_repeat_shape" CHECK (("meetup_plans"."repeat_unit" is null and "meetup_plans"."repeat_every" = 1 and "meetup_plans"."repeat_until" is null) or ("meetup_plans"."repeat_unit" is not null and "meetup_plans"."repeat_unit" in ('day', 'week', 'month', 'year')));

-- ─── Un plan est-il fini ? ─────────────────────────────────────────────────────────────────
-- Une seule fois : quand il est terminé. Récurrent : quand son dernier jour (repeat_until, heure
-- locale) est passé ; sans fin, jamais. Fonction interne.
CREATE OR REPLACE FUNCTION public.meetup_plan_over(p_ends_at timestamptz, p_unit text, p_until date)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_unit IS NULL THEN p_ends_at <= now()
    ELSE p_until IS NOT NULL AND p_until < (now() AT TIME ZONE 'America/Toronto')::date
  END;
$$;


-- ─── Bloc « plan » dans l'horaire ──────────────────────────────────────────────────────────
-- Comme avant (migration 0009), mais un plan récurrent donne UN bloc qui se répète (mêmes
-- colonnes que la répétition personnalisée de la story 2), ancré sur la première fois. Il
-- compte donc comme occupé partout (recherche de moments, « libre maintenant », étude). Un
-- bloc « tous les jours » compte pour 7 dans la limite de 1000 blocs (migration 0016).
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
    valid_from, valid_until, source, meetup_plan_id, repeat_unit, repeat_every)
  VALUES (
    uid,
    left(coalesce(nullif(trim(plan.title), ''), 'Plan de groupe'), 100),
    plan.place_id,
    local_start::time,
    -- Le plan finit le même jour, ou pile à minuit (propose_meetup le vérifie).
    CASE WHEN local_end::date = local_start::date THEN local_end::time ELSE '24:00'::time END,
    -- Chaque semaine : le jour de semaine de la première fois (1 = lundi … 7 = dimanche).
    CASE WHEN plan.repeat_unit = 'week' THEN extract(isodow FROM local_start)::smallint END,
    local_start::date,
    CASE WHEN plan.repeat_unit IS NULL THEN local_start::date ELSE plan.repeat_until END,
    'meetup',
    pid,
    plan.repeat_unit,
    plan.repeat_every
  )
  ON CONFLICT (meetup_plan_id, owner_id) DO NOTHING;
END;
$$;


-- ─── Proposer un plan récurrent ────────────────────────────────────────────────────────────
-- Mêmes règles que propose_meetup (qui fait toutes ses vérifications et limites) pour la
-- première fois, puis « tous les X jours / semaines / mois / ans » jusqu'à `p_repeat_until`
-- (nul = sans fin ; au plus 10 ans après la première fois). Le créateur est inscrit d'office.
CREATE OR REPLACE FUNCTION public.propose_recurring_meetup(
  p_group uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text,
  p_repeat_unit text,
  p_repeat_every integer,
  p_repeat_until date DEFAULT NULL,
  p_place uuid DEFAULT NULL,
  p_location text DEFAULT '',
  p_invitees uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  first_day date;
  pid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  IF p_repeat_unit IS NULL OR p_repeat_unit NOT IN ('day', 'week', 'month', 'year') THEN
    RAISE EXCEPTION 'Répétition invalide.' USING ERRCODE = '22023';
  END IF;
  IF p_repeat_every IS NULL OR p_repeat_every NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'La répétition va de 1 à 99.' USING ERRCODE = '22023';
  END IF;
  IF p_starts_at IS NOT NULL AND p_repeat_until IS NOT NULL THEN
    first_day := (p_starts_at AT TIME ZONE 'America/Toronto')::date;
    IF p_repeat_until < first_day OR p_repeat_until - first_day >= 3650 THEN
      RAISE EXCEPTION 'La fin doit être après la première fois (10 ans au plus).'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  pid := public.propose_meetup(p_group, p_starts_at, p_ends_at, p_title, p_place, p_location,
    p_invitees);
  UPDATE public.meetup_plans
  SET repeat_unit = p_repeat_unit, repeat_every = p_repeat_every, repeat_until = p_repeat_until
  WHERE id = pid;
  -- Le bloc du créateur a été ajouté sans répétition : on le remplace.
  DELETE FROM public.busy_blocks b WHERE b.meetup_plan_id = pid;
  PERFORM public.add_meetup_block(pid, uid);
  RETURN pid;
END;
$$;


-- ─── Répondre ──────────────────────────────────────────────────────────────────────────────
-- Comme avant (migration 0009). Un plan récurrent reste ouvert tant que sa série n'est pas
-- finie : on peut l'accepter (toute la série) ou le quitter (« Refuser ») à tout moment.
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
  IF public.meetup_plan_over(plan.ends_at, plan.repeat_unit, plan.repeat_until) THEN
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


-- ─── Annuler un plan / arrêter une série ───────────────────────────────────────────────────
-- Comme avant (migration 0009) : le plan reste visible (annulé) et son bloc est retiré de
-- l'horaire de tous. Une série récurrente peut aussi être arrêtée par une personne qui l'a
-- acceptée (ex. les deux amis du gym), pas seulement par son créateur.
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
  IF plan.created_by <> uid AND NOT (
    plan.repeat_unit IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.plan_votes v
      WHERE v.plan_id = p_plan AND v.user_id = uid AND v.vote = 'yes'
    )
  ) THEN
    IF plan.repeat_unit IS NOT NULL THEN
      RAISE EXCEPTION 'Seules les personnes inscrites à cette série peuvent l''arrêter.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Seule la personne qui a proposé ce plan peut l''annuler.'
      USING ERRCODE = '42501';
  END IF;
  IF plan.status = 'cancelled' THEN
    RETURN;
  END IF;
  IF public.meetup_plan_over(plan.ends_at, plan.repeat_unit, plan.repeat_until) THEN
    RAISE EXCEPTION 'Ce plan est passé.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.meetup_plans SET status = 'cancelled' WHERE id = p_plan;
  DELETE FROM public.busy_blocks b WHERE b.meetup_plan_id = p_plan;
END;
$$;


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.meetup_plan_over(timestamptz, text, date),
  public.add_meetup_block(uuid, uuid),
  public.propose_recurring_meetup(uuid, timestamptz, timestamptz, text, text, integer, date, uuid,
    text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.propose_recurring_meetup(uuid, timestamptz, timestamptz, text, text, integer, date, uuid,
    text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid) TO authenticated;

-- ─── Migration 0019_review_series_limit ──────────────────────────────────────────────

-- Revue story 5 : la limite « 50 plans à venir » par groupe comptait seulement les plans dont
-- la PREMIÈRE fois n'était pas passée (`ends_at > now()`). Une série récurrente sortait donc du
-- compte dès sa première fois, alors qu'elle continue d'apparaître chez tous les membres. Avec
-- 30 propositions par jour et par groupe, le nombre de séries en cours n'avait plus de limite.
-- Maintenant, un plan compte tant qu'il n'est pas fini (`meetup_plan_over`, migration 0018).
-- Seule cette condition change ; le reste est identique à la migration 0009.
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
      WHERE m.group_id = p_group AND m.status = 'proposed'
        AND NOT public.meetup_plan_over(m.ends_at, m.repeat_unit, m.repeat_until)) >= 50 THEN
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

-- ─── Migration 0020_usernames ────────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "username" text;
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles" USING btree ("username");
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_username_format" CHECK ("profiles"."username" ~ '^[a-z0-9][a-z0-9_.]{2,19}$');
-- Création de compte avec nom d'utilisateur et mot de passe (plus de lien par courriel).
-- Le formulaire /inscription passe le nom dans les métadonnées du compte
-- (`raw_user_meta_data.username`) ; le déclencheur le copie dans le profil. S'il est déjà pris
-- (deux inscriptions en même temps), l'index unique fait échouer l'inscription : le compte
-- n'est pas créé. Un nom absent ou mal formé (compte Google) laisse `username` vide.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  wanted text := lower(trim(coalesce(NEW.raw_user_meta_data ->> 'username', '')));
  uname text := CASE WHEN wanted ~ '^[a-z0-9][a-z0-9_.]{2,19}$' THEN wanted END;
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    left(
      coalesce(
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        uname,
        nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
        ''
      ),
      60
    ),
    uname
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;

-- ─── Migration 0021_skip_days ────────────────────────────────────────────────────────

ALTER TABLE "busy_blocks" ADD COLUMN "skip_days" date[] DEFAULT '{}'::date[] NOT NULL;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_skip_days_count" CHECK (cardinality("busy_blocks"."skip_days") <= 60);
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_skip_days_recurring" CHECK (cardinality("busy_blocks"."skip_days") = 0 or "busy_blocks"."weekday" is not null or "busy_blocks"."repeat_unit" is not null);

-- ─── « Cours annulé cette fois-ci » : annuler une occurrence d'un bloc qui revient ────────
-- `skip_days` : les jours où le bloc n'a PAS lieu. Droits par colonne (migration 0009) : la
-- personne écrit les jours annulés de ses propres blocs (la RLS limite déjà aux siens ; un
-- bloc de plan de groupe ne se modifie pas directement, migration 0009).
GRANT UPDATE (skip_days) ON public.busy_blocks TO authenticated;


-- L'horaire du groupe renvoie aussi les jours annulés (sinon un cours annulé compterait encore
-- comme occupé pour les autres). Le type de retour change : on recrée la fonction. Le reste
-- est inchangé (migration 0017).
DROP FUNCTION public.group_busy_blocks(uuid);

CREATE FUNCTION public.group_busy_blocks(gid uuid)
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
  valid_until date,
  repeat_unit text,
  repeat_every smallint,
  skip_days date[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
        OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until,
    b.repeat_unit,
    b.repeat_every,
    b.skip_days
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
