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
--> statement-breakpoint
GRANT UPDATE (role) ON public.group_members TO authenticated;
--> statement-breakpoint
REVOKE UPDATE ON public.groups FROM authenticated;
--> statement-breakpoint
GRANT UPDATE (name, invite_code) ON public.groups TO authenticated;
--> statement-breakpoint

-- Supabase donne par défaut EXECUTE sur les nouvelles fonctions à anon (droits par défaut du
-- schéma public), ce que « REVOKE … FROM PUBLIC » n'enlève pas. Les visiteurs non connectés
-- n'ont besoin d'aucune de ces fonctions.
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid), public.is_group_admin(uuid),
  public.shares_group_with(uuid), public.join_group_by_code(text),
  public.handle_new_user(), public.handle_new_group() FROM anon;
