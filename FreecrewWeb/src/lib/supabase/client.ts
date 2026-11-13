"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env";

/** Client Supabase côté navigateur, ou `null` si Supabase n'est pas configuré. */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  return env ? createBrowserClient(env.url, env.anonKey) : null;
}
