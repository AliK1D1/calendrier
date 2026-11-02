-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0005_review_limits SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0005_review_limits.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0005_review_limits ────────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 8) : la base applique les mêmes limites que les
-- formulaires. La clé « anon » est publique : une personne connectée peut écrire directement
-- dans Supabase (API REST) sans passer par les actions serveur et leur validation.
-- NOT VALID : la règle vaut pour toute nouvelle écriture, sans échouer sur d'éventuelles
-- lignes déjà enregistrées.
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_title_length" CHECK (length("busy_blocks"."title") <= 100) NOT VALID;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_validity_span" CHECK ("busy_blocks"."valid_from" is null or "busy_blocks"."valid_until" is null or "busy_blocks"."valid_until" - "busy_blocks"."valid_from" < 366) NOT VALID;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_display_name_length" CHECK (length("profiles"."display_name") <= 60) NOT VALID;
-- Le nom tiré du compte Google ou du courriel peut dépasser 60 caractères : on le coupe, sinon
-- la nouvelle limite ferait échouer l'inscription.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    left(
      coalesce(
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
        ''
      ),
      60
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;

COMMIT;
