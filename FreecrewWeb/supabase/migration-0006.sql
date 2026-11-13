-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0006_groups SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0006_groups.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

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

COMMIT;
