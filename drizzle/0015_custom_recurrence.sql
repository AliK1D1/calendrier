ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_validity_span";--> statement-breakpoint
ALTER TABLE "busy_blocks" DROP CONSTRAINT "busy_blocks_one_off_has_day";--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD COLUMN "repeat_unit" text;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD COLUMN "repeat_every" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_every_range" CHECK ("busy_blocks"."repeat_every" between 1 and 99);--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_shape" CHECK (("busy_blocks"."repeat_unit" is null and "busy_blocks"."repeat_every" = 1) or ("busy_blocks"."repeat_unit" is not null and (("busy_blocks"."repeat_unit" = 'week' and "busy_blocks"."weekday" is not null and "busy_blocks"."valid_from" is not null) or ("busy_blocks"."repeat_unit" in ('day', 'month', 'year') and "busy_blocks"."weekday" is null and "busy_blocks"."valid_from" is not null))));--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_repeat_manual" CHECK ("busy_blocks"."repeat_unit" is null or "busy_blocks"."source"::text = 'manual');--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_validity_span" CHECK ("busy_blocks"."valid_from" is null or "busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" - "busy_blocks"."valid_from" < (case when "busy_blocks"."repeat_unit" is null then 366 else 3660 end));--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_one_off_has_day" CHECK ("busy_blocks"."weekday" is not null or "busy_blocks"."repeat_unit" is not null or ("busy_blocks"."valid_from" is not null and ("busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" = "busy_blocks"."valid_from")));--> statement-breakpoint

-- ─── Story 2 : répétition personnalisée (« tous les X jours / semaines / mois / ans ») ────
-- Droits par colonne (migration 0009) : la personne peut écrire la répétition de ses blocs.
GRANT INSERT (repeat_unit, repeat_every), UPDATE (repeat_unit, repeat_every)
  ON public.busy_blocks TO authenticated;
--> statement-breakpoint

-- L'horaire du groupe renvoie aussi la répétition (sinon un bloc « toutes les 2 semaines »
-- compterait chaque semaine pour les autres). Le type de retour change : on recrée la
-- fonction. Le reste est inchangé (migration 0014).
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
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;
