-- Migration écrite à la main : fonctions, triggers, droits et politiques RLS.
-- Règle : un utilisateur voit ses données et celles des membres de ses groupes ;
-- il ne modifie que les siennes.
--
-- Les fonctions d'aide sont SECURITY DEFINER : elles lisent group_members sans repasser par
-- ses propres politiques RLS (sinon une politique de group_members qui lit group_members
-- boucle à l'infini : « infinite recursion detected in policy »).
-- search_path vide + noms qualifiés : recommandé par Supabase pour les SECURITY DEFINER.

-- ─── Fonctions d'aide ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_group_member(gid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = gid AND m.user_id = (SELECT auth.uid())
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_group_admin(gid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = gid AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'
  );
$$;
--> statement-breakpoint
-- Vrai si `other` est l'utilisateur connecté ou partage au moins un groupe avec lui.
CREATE OR REPLACE FUNCTION public.shares_group_with(other uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT other = (SELECT auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.group_members mine
    JOIN public.group_members theirs ON theirs.group_id = mine.group_id
    WHERE mine.user_id = (SELECT auth.uid()) AND theirs.user_id = other
  );
$$;
--> statement-breakpoint
-- Rejoindre un groupe avec son code d'invitation (un non-membre ne peut pas lire `groups`).
CREATE OR REPLACE FUNCTION public.join_group_by_code(code text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  gid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  SELECT g.id INTO gid FROM public.groups g WHERE g.invite_code = trim(code);
  IF gid IS NULL THEN
    RAISE EXCEPTION 'Code d''invitation invalide' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (gid, uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN gid;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.is_group_admin(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.shares_group_with(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.join_group_by_code(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.shares_group_with(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text) TO authenticated;
--> statement-breakpoint

-- ─── Triggers ──────────────────────────────────────────────────────────────────────────────

-- Création du profil à l'inscription (lien magique ou Google).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    coalesce(
      nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
      ''
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint
-- Le créateur d'un groupe en devient l'administrateur.
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin')
  ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_group_created ON public.groups;
--> statement-breakpoint
CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS plan_votes_touch ON public.plan_votes;
--> statement-breakpoint
CREATE TRIGGER plan_votes_touch
  BEFORE UPDATE ON public.plan_votes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.handle_new_group() FROM PUBLIC;
--> statement-breakpoint

-- ─── Droits sur les tables ─────────────────────────────────────────────────────────────────
-- Les visiteurs non connectés (anon) n'ont accès à rien ; RLS filtre le reste.

REVOKE ALL ON public.profiles, public.places, public.busy_blocks, public.groups,
  public.group_members, public.meetup_plans, public.plan_votes FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.places, public.busy_blocks,
  public.groups, public.group_members, public.meetup_plans, public.plan_votes TO authenticated;
--> statement-breakpoint

-- ─── Row Level Security ────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.busy_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.meetup_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.plan_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- profiles : je vois mon profil et ceux des membres de mes groupes ; je modifie le mien.
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.shares_group_with(id));
--> statement-breakpoint
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (
      home_place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = home_place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );
--> statement-breakpoint

-- places : mêmes règles.
CREATE POLICY places_select ON public.places FOR SELECT TO authenticated
  USING (public.shares_group_with(owner_id));
--> statement-breakpoint
CREATE POLICY places_insert ON public.places FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY places_update ON public.places FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY places_delete ON public.places FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

-- busy_blocks : l'horaire. Lisible par moi et les membres de mes groupes seulement.
CREATE POLICY busy_blocks_select ON public.busy_blocks FOR SELECT TO authenticated
  USING (public.shares_group_with(owner_id));
--> statement-breakpoint
CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );
--> statement-breakpoint
CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );
--> statement-breakpoint
CREATE POLICY busy_blocks_delete ON public.busy_blocks FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

-- groups : visibles par leurs membres (et leur créateur, pour INSERT … RETURNING).
CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated
  USING (public.is_group_member(id) OR created_by = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY groups_insert ON public.groups FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY groups_update ON public.groups FOR UPDATE TO authenticated
  USING (public.is_group_admin(id))
  WITH CHECK (public.is_group_admin(id));
--> statement-breakpoint
CREATE POLICY groups_delete ON public.groups FOR DELETE TO authenticated
  USING (public.is_group_admin(id));
--> statement-breakpoint

-- group_members : on entre par join_group_by_code (ou en créant le groupe) ; pas d'INSERT
-- direct. On peut quitter un groupe ; l'admin peut retirer un membre ou changer un rôle.
CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));
--> statement-breakpoint
CREATE POLICY group_members_update ON public.group_members FOR UPDATE TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));
--> statement-breakpoint
CREATE POLICY group_members_delete ON public.group_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_group_admin(group_id));
--> statement-breakpoint

-- meetup_plans : visibles par les membres du groupe ; créés par un membre, modifiés par
-- leur créateur. Le lieu doit appartenir à un membre du groupe.
CREATE POLICY meetup_plans_select ON public.meetup_plans FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));
--> statement-breakpoint
CREATE POLICY meetup_plans_insert ON public.meetup_plans FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_group_member(group_id)
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        JOIN public.group_members gm ON gm.user_id = p.owner_id
        WHERE p.id = place_id AND gm.group_id = meetup_plans.group_id
      )
    )
  );
--> statement-breakpoint
CREATE POLICY meetup_plans_update ON public.meetup_plans FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_group_member(group_id)
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        JOIN public.group_members gm ON gm.user_id = p.owner_id
        WHERE p.id = place_id AND gm.group_id = meetup_plans.group_id
      )
    )
  );
--> statement-breakpoint
CREATE POLICY meetup_plans_delete ON public.meetup_plans FOR DELETE TO authenticated
  USING (created_by = (SELECT auth.uid()));
--> statement-breakpoint

-- plan_votes : visibles par les membres du groupe du plan ; chacun gère son propre vote.
CREATE POLICY plan_votes_select ON public.plan_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );
--> statement-breakpoint
CREATE POLICY plan_votes_insert ON public.plan_votes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );
--> statement-breakpoint
CREATE POLICY plan_votes_update ON public.plan_votes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.meetup_plans p
      WHERE p.id = plan_id AND public.is_group_member(p.group_id)
    )
  );
--> statement-breakpoint
CREATE POLICY plan_votes_delete ON public.plan_votes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
