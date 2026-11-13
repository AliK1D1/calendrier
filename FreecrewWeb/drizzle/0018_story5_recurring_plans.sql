-- Story 5 : plans récurrents partagés (« le gym tous les 2 jours avec Sam »). Début généré par
-- drizzle-kit (colonnes de répétition des plans ; les blocs « plan » peuvent maintenant se
-- répéter), suite écrite à la main (fonctions).
ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_repeat_manual";--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_unit" text;--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_every" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD COLUMN "repeat_until" date;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_manual" CHECK ("busy_blocks"."repeat_unit" is null or "busy_blocks"."source"::text in ('manual', 'meetup'));--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_repeat_every_range" CHECK ("meetup_plans"."repeat_every" between 1 and 99);--> statement-breakpoint
ALTER TABLE "meetup_plans" ADD CONSTRAINT "meetup_plans_repeat_shape" CHECK (("meetup_plans"."repeat_unit" is null and "meetup_plans"."repeat_every" = 1 and "meetup_plans"."repeat_until" is null) or ("meetup_plans"."repeat_unit" is not null and "meetup_plans"."repeat_unit" in ('day', 'week', 'month', 'year')));--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.meetup_plan_over(timestamptz, text, date),
  public.add_meetup_block(uuid, uuid),
  public.propose_recurring_meetup(uuid, timestamptz, timestamptz, text, text, integer, date, uuid,
    text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.propose_recurring_meetup(uuid, timestamptz, timestamptz, text, text, integer, date, uuid,
    text, uuid[]),
  public.respond_to_meetup(uuid, boolean), public.cancel_meetup(uuid) TO authenticated;
