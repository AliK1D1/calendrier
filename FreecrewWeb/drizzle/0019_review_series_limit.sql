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
