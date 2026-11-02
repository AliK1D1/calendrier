import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mon rôle dans un groupe. */
export type GroupRole = "admin" | "member";

export interface MyGroupSummary {
  id: string;
  name: string;
  role: GroupRole;
  memberCount: number;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupFavorite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ownerId: string;
}

/** Bloc d'un membre tel que renvoyé par `group_busy_blocks` (titre masqué selon son choix). */
export interface GroupBusyBlock {
  id: string;
  owner_id: string;
  title: string;
  title_hidden: boolean;
  place_id: string | null;
  start_time: string;
  end_time: string;
  weekday: number | null;
  valid_from: string | null;
  valid_until: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  inviteCode: string;
  myRole: GroupRole;
  members: GroupMember[];
  favorites: GroupFavorite[];
  blocks: GroupBusyBlock[];
  /** Noms des lieux des blocs (lisibles selon la RLS de `places`). */
  placeNames: Record<string, string>;
}

/** Mes groupes (la RLS ne renvoie que ceux dont je suis membre). */
export async function getMyGroups(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyGroupSummary[]> {
  const [groups, mine] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, created_at, group_members(count)")
      .order("created_at", { ascending: true })
      .returns<{ id: string; name: string; group_members: { count: number }[] }[]>(),
    supabase
      .from("group_members")
      .select("group_id, role")
      .eq("user_id", userId)
      .returns<{ group_id: string; role: GroupRole }[]>(),
  ]);
  if (groups.error) throw new Error(`Lecture des groupes : ${groups.error.message}`);
  if (mine.error) throw new Error(`Lecture des groupes : ${mine.error.message}`);
  const roles = new Map((mine.data ?? []).map((m) => [m.group_id, m.role]));
  return (groups.data ?? [])
    .filter((g) => roles.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      role: roles.get(g.id) ?? "member",
      memberCount: g.group_members[0]?.count ?? 0,
    }));
}

/** Détail d'un groupe dont je suis membre, ou `null` (inexistant ou pas membre : même réponse). */
export async function getGroupDetail(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<GroupDetail | null> {
  const { data: group, error } = await supabase
    .from("groups")
    .select("id, name, invite_code")
    .eq("id", groupId)
    .maybeSingle<{ id: string; name: string; invite_code: string }>();
  if (error) throw new Error(`Lecture du groupe : ${error.message}`);
  if (!group) return null;

  const [members, favorites, blocks] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, role, joined_at, profiles(display_name)")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true })
      .returns<
        {
          user_id: string;
          role: GroupRole;
          joined_at: string;
          profiles: { display_name: string } | null;
        }[]
      >(),
    supabase
      .from("places")
      .select("id, name, lat, lng, owner_id")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .returns<{ id: string; name: string; lat: number; lng: number; owner_id: string }[]>(),
    supabase.rpc("group_busy_blocks", { gid: groupId }),
  ]);
  if (members.error) throw new Error(`Lecture des membres : ${members.error.message}`);
  if (favorites.error) throw new Error(`Lecture des lieux du groupe : ${favorites.error.message}`);
  if (blocks.error) throw new Error(`Lecture des horaires : ${blocks.error.message}`);

  const memberList: GroupMember[] = (members.data ?? []).map((m) => ({
    userId: m.user_id,
    displayName: m.profiles?.display_name || "Sans nom",
    role: m.role,
    joinedAt: m.joined_at,
  }));
  const me = memberList.find((m) => m.userId === userId);
  if (!me) return null;

  // supabase-js sans types générés ne connaît pas la forme d'une fonction : on la précise.
  const blockList = (blocks.data ?? []) as unknown as GroupBusyBlock[];
  const placeIds = [...new Set(blockList.map((b) => b.place_id).filter((id) => id !== null))];
  const placeNames: Record<string, string> = {};
  if (placeIds.length > 0) {
    const { data: places, error: e } = await supabase
      .from("places")
      .select("id, name")
      .in("id", placeIds)
      .returns<{ id: string; name: string }[]>();
    if (e) throw new Error(`Lecture des lieux : ${e.message}`);
    for (const p of places ?? []) placeNames[p.id] = p.name;
  }

  return {
    id: group.id,
    name: group.name,
    inviteCode: group.invite_code,
    myRole: me.role,
    members: memberList,
    favorites: (favorites.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      lat: f.lat,
      lng: f.lng,
      ownerId: f.owner_id,
    })),
    blocks: blockList,
    placeNames,
  };
}
