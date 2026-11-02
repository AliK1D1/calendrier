import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Déconnexion (formulaire POST ; pas de GET, pour qu'un simple lien ne déconnecte pas). */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
