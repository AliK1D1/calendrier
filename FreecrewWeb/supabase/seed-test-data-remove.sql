-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : efface les jeux de données de test (créés par supabase/seed-test-data.sql).
--
-- FICHIER GÉNÉRÉ par « npm run db:seed-sql » : ne pas le modifier à la main.
--
-- Supprime seulement les comptes freecrew.<nom>@example.com. Leurs profils, lieux,
-- horaires, groupes et plans partent avec eux (suppression en cascade). Rien d'autre n'est
-- touché.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM auth.users
WHERE email IN (
  'freecrew.ali@example.com',
  'freecrew.sam@example.com',
  'freecrew.maya@example.com',
  'freecrew.leo@example.com',
  'freecrew.nora@example.com',
  'freecrew.zoe@example.com',
  'freecrew.felix@example.com',
  'freecrew.jade@example.com',
  'freecrew.hugo@example.com',
  'freecrew.lina@example.com'
);

COMMIT;
