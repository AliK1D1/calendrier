-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration 0002_review_hardening SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0002_review_hardening.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0002_review_hardening ─────────────────────────────────────────────────

-- Migration de la revue sécurité (segment 6).
--
-- Faille corrigée : les politiques group_members_update et groups_update vérifient seulement
-- que l'auteur est admin du groupe. Or un UPDATE peut changer n'importe quelle colonne. Un
-- admin (donc n'importe qui : il suffit de créer un groupe) pouvait réécrire une ligne de
-- membre « UPDATE group_members SET user_id = <inconnu> » et ajouter de force un inconnu à
-- son groupe, puis lire son horaire et ses lieux (shares_group_with devient vrai).
--
-- Correctif : droits par colonne. Sur group_members, on ne peut modifier que le rôle ; sur
-- groups, que le nom et le code d'invitation. Les politiques RLS restent les mêmes.

REVOKE UPDATE ON public.group_members FROM authenticated;

GRANT UPDATE (role) ON public.group_members TO authenticated;

REVOKE UPDATE ON public.groups FROM authenticated;

GRANT UPDATE (name, invite_code) ON public.groups TO authenticated;


-- Supabase donne par défaut EXECUTE sur les nouvelles fonctions à anon (droits par défaut du
-- schéma public), ce que « REVOKE … FROM PUBLIC » n'enlève pas. Les visiteurs non connectés
-- n'ont besoin d'aucune de ces fonctions.
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid), public.is_group_admin(uuid),
  public.shares_group_with(uuid), public.join_group_by_code(text),
  public.handle_new_user(), public.handle_new_group() FROM anon;

COMMIT;
