import { type NextRequest, NextResponse } from "next/server";

import { subscriptionDeps } from "@/lib/subscriptions/server";
import { syncSubscriptions } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Jusqu'à 5 calendriers téléchargés en même temps, 10 s au plus chacun. Si la fonction est
// coupée, le verrou de synchro expire seul après 2 min.
export const maxDuration = 60;

/**
 * Synchronisation automatique des calendriers abonnés, appelée par l'app ouverte. Ne fait
 * rien si aucun calendrier n'est dû (dernière synchro il y a moins de 6 h, vérifié par la BD).
 * Réponse : `{ changed }` (vrai : nouvelles données, recharger la page).
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
  if (!sameSite) return NextResponse.json({ changed: false }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ changed: false });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ changed: false }, { status: 401 });

  const r = await syncSubscriptions(subscriptionDeps(supabase, data.user.id), { manual: false });
  return NextResponse.json({ changed: r.synced > 0 }, { headers: { "Cache-Control": "no-store" } });
}
