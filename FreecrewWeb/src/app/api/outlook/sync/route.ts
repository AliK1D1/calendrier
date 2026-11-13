import { type NextRequest, NextResponse } from "next/server";

import { outlookDeps } from "@/lib/outlook/server";
import { syncOutlook } from "@/lib/outlook/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Microsoft peut être lent (plusieurs pages d'événements). Si la fonction est coupée, le
// verrou de synchro expire seul après 2 min.
export const maxDuration = 60;

/**
 * Synchronisation automatique, appelée par l'app ouverte (au chargement, puis aux 15 min).
 * Ne fait rien si Outlook n'est pas connecté ou si la dernière synchro date de moins de
 * 15 min (vérifié par la BD). Réponse : `{ changed }` (vrai : nouvelles données, recharger la page).
 */
export async function POST(request: NextRequest) {
  // Seulement depuis l'app elle-même (le navigateur envoie toujours Origin pour un POST).
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let sameSite = true;
  try {
    sameSite = !origin || new URL(origin).host === host;
  } catch {
    sameSite = false;
  }
  if (!sameSite) {
    return NextResponse.json({ changed: false }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ changed: false });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ changed: false }, { status: 401 });
  const deps = outlookDeps(supabase, data.user.id);
  if (!deps) return NextResponse.json({ changed: false });

  const r = await syncOutlook(deps, { manual: false });
  return NextResponse.json(
    { changed: r.status === "synced" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
