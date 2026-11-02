-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0004_quiet_hours SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0004_quiet_hours.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0004_quiet_hours ──────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "unavailable_before" time;
ALTER TABLE "profiles" ADD COLUMN "unavailable_after" time;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unavailable_order" CHECK ("profiles"."unavailable_before" is null or "profiles"."unavailable_after" is null or "profiles"."unavailable_after" > "profiles"."unavailable_before");

COMMIT;
