-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0022_outing_limits SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0022_outing_limits.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0022_outing_limits ────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "max_outings_per_day" smallint;
ALTER TABLE "profiles" ADD COLUMN "max_outings_per_week" smallint;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_max_outings_per_day_range" CHECK ("profiles"."max_outings_per_day" is null or "profiles"."max_outings_per_day" between 1 and 5);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_max_outings_per_week_range" CHECK ("profiles"."max_outings_per_week" is null or "profiles"."max_outings_per_week" between 1 and 21);

-- ─── Limite de sorties : « pas plus d'une sortie par jour / de 3 par semaine » ────────────
-- Les deux colonnes sont dans `profiles` (la personne écrit son profil, RLS de la 0001 ; les
-- membres de ses groupes le lisent déjà, comme les heures où elle ne sort pas).
-- Pour compter les sorties des autres membres, l'horaire du groupe dit maintenant si un bloc
-- est une sortie (un plan de groupe, de ce groupe ou d'un autre) : `is_outing`. Ni le titre ni
-- le groupe d'un plan d'ailleurs ne sont révélés (toujours « Occupé », migration 0010). Le type
-- de retour change : on recrée la fonction. Le reste est inchangé (migration 0021).
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
  skip_days date[],
  is_outing boolean
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
    b.skip_days,
    b.source::text = 'meetup'
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
