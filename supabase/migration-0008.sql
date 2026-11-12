-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0008_review_row_limits SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0008_review_row_limits.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0008_review_row_limits ────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 11).
--
-- Faille corrigée : aucune limite sur le nombre de lieux et de blocs d'horaire. Avec la clé
-- anon (publique) et son jeton, une personne pouvait en créer des dizaines de milliers par
-- l'API REST. Les membres de ses groupes les chargent ensuite à chaque visite de la page du
-- groupe et à chaque recherche de moments. Les limites sont très au-dessus d'un usage normal
-- (un horaire de cégep : 20 à 40 blocs, quelques lieux).
CREATE OR REPLACE FUNCTION public.enforce_row_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'busy_blocks' THEN
    IF (SELECT count(*) FROM public.busy_blocks b WHERE b.owner_id = NEW.owner_id) >= 1000 THEN
      RAISE EXCEPTION 'Trop de blocs dans l''horaire (1000 au maximum)' USING ERRCODE = '54000';
    END IF;
  ELSIF TG_TABLE_NAME = 'places' THEN
    IF TG_OP = 'INSERT'
      AND (SELECT count(*) FROM public.places p WHERE p.owner_id = NEW.owner_id) >= 200 THEN
      RAISE EXCEPTION 'Trop de lieux (200 au maximum)' USING ERRCODE = '54000';
    END IF;
    IF NEW.group_id IS NOT NULL
      AND (TG_OP = 'INSERT' OR OLD.group_id IS DISTINCT FROM NEW.group_id)
      AND (SELECT count(*) FROM public.places p WHERE p.group_id = NEW.group_id) >= 100 THEN
      RAISE EXCEPTION 'Trop de lieux dans ce groupe (100 au maximum)' USING ERRCODE = '54000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS busy_blocks_row_limit ON public.busy_blocks;

CREATE TRIGGER busy_blocks_row_limit
  BEFORE INSERT ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_limits();

DROP TRIGGER IF EXISTS places_row_limit ON public.places;

CREATE TRIGGER places_row_limit
  BEFORE INSERT OR UPDATE OF group_id ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_limits();

REVOKE EXECUTE ON FUNCTION public.enforce_row_limits() FROM PUBLIC, anon;

COMMIT;
