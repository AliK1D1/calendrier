-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0009_segment12_meetup_invites SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0009_segment12_meetup_invites.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

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

COMMIT;
