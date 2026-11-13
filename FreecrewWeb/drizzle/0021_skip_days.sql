ALTER TABLE "busy_blocks" ADD COLUMN "skip_days" date[] DEFAULT '{}'::date[] NOT NULL;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_skip_days_count" CHECK (cardinality("busy_blocks"."skip_days") <= 60);--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_skip_days_recurring" CHECK (cardinality("busy_blocks"."skip_days") = 0 or "busy_blocks"."weekday" is not null or "busy_blocks"."repeat_unit" is not null);--> statement-breakpoint

-- ─── « Cours annulé cette fois-ci » : annuler une occurrence d'un bloc qui revient ────────
-- `skip_days` : les jours où le bloc n'a PAS lieu. Droits par colonne (migration 0009) : la
-- personne écrit les jours annulés de ses propres blocs (la RLS limite déjà aux siens ; un
-- bloc de plan de groupe ne se modifie pas directement, migration 0009).
GRANT UPDATE (skip_days) ON public.busy_blocks TO authenticated;
--> statement-breakpoint

-- L'horaire du groupe renvoie aussi les jours annulés (sinon un cours annulé compterait encore
-- comme occupé pour les autres). Le type de retour change : on recrée la fonction. Le reste
-- est inchangé (migration 0017).
DROP FUNCTION public.group_busy_blocks(uuid);
--> statement-breakpoint
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
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;
