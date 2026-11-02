/**
 * Le strict minimum de Supabase pour tester les migrations sur PGlite (sans réseau) : schéma
 * `auth` (table `auth.users`, fonction `auth.uid()` qui lit `request.jwt.claim.sub`, comme
 * Supabase) et rôles `anon` / `authenticated`.
 */
import type { PGlite } from "@electric-sql/pglite";

export const FAKE_SUPABASE = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
`;

/**
 * Exécute `fn` en tant qu'utilisateur connecté `uid` (rôle authenticated, donc RLS), ou en
 * visiteur anonyme si `uid` est nul, puis revient au rôle d'origine.
 */
export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "SET ROLE authenticated" : "SET ROLE anon");
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
