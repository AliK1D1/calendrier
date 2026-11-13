import { NextResponse } from "next/server";

import { getSiteOrigin } from "@/lib/auth/origin";
import { validateUuid } from "@/lib/groups/validation";
import { buildPlanIcs } from "@/lib/plans/ics";
import { loadPlans } from "@/lib/plans/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * « Ajouter à mon agenda » : fichier .ics d'un plan que j'ai accepté ou proposé (lu avec ma
 * session : la RLS ne renvoie que les plans de mes groupes). Sinon 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pid = validateUuid(id, "Plan introuvable.");
  const notFound = () => new NextResponse("Plan introuvable.", { status: 404 });
  if (!pid.ok) return notFound();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return notFound();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new NextResponse("Connexion requise.", { status: 401 });

  const now = new Date();
  const res = await loadPlans(supabase, data.user.id, now, { planId: pid.value });
  const view = res.ok ? res.views.find((v) => v.id === pid.value) : undefined;
  if (!view || view.state === "cancelled" || !(view.myResponse === "yes" || view.isMine)) {
    return notFound();
  }
  const body = buildPlanIcs(view, now, `${await getSiteOrigin()}/plans`);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="plan-${view.id.slice(0, 8)}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
