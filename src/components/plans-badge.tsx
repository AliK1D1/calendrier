import { countAwaitingPlans } from "@/lib/plans/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pastille « plans en attente de ma réponse » à côté de « Plans » dans l'en-tête : c'est la
 * notification dans l'app (pas de courriel ni de notification poussée pour l'instant).
 * Rien si on n'est pas connecté, s'il n'y a rien, ou si la lecture échoue.
 */
export async function PlansBadge() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const n = await countAwaitingPlans(supabase, data.user.id, new Date());
  if (n === 0) return null;
  return (
    <span
      className="bg-destructive ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] leading-5 font-semibold text-white tabular-nums"
      aria-label={`${n} en attente de ta réponse`}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}
