-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0013_review_availability_limit SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0013_review_availability_limit.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

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

COMMIT;
