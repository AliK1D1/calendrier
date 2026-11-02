-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0007_review_kick_new_code SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0007_review_kick_new_code.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

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

COMMIT;
