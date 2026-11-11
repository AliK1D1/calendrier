-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0010_review_plan_privacy SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0010_review_plan_privacy.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

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
