import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { toBlockSpec } from "@/lib/db/convert";
import { getMyBusyBlocks, getMyPlaces, getMyProfile, getMyQuietHours } from "@/lib/profile";
import { quietHoursFromDb } from "@/lib/scheduling/quietHours";
import { TIME_ZONE } from "@/lib/scheduling/time";
import { getTravelProvider } from "@/lib/travel/server";
import { type ConflictView, myStudyConflicts } from "@/lib/study/service";
import { supabaseStudyStore } from "@/lib/study/supabaseStore";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  accepterSeances,
  planifierEtude,
  replanifierConflits,
  verifierSeance,
} from "../etude/actions";

import { ajouterBlocs, modifierBloc, supprimerBloc } from "./actions";
import { apercuIcs, confirmerIcs } from "./import-actions";
import { ScheduleEditor } from "./schedule-editor";
import type { ScheduleBlock } from "./types";

export const metadata: Metadata = { title: "Mon horaire · Temps libre commun" };
export const dynamic = "force-dynamic";

export default async function MonHoraire({
  searchParams,
}: {
  searchParams: Promise<{ etude?: string | string[] }>;
}) {
  const { etude } = await searchParams;
  const start = etude === "planifier" || etude === "replanifier" ? etude : null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/connexion?erreur=config&next=/horaire");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion?next=/horaire");
  const userId = data.user.id;

  const [profile, places, rows, quietRow] = await Promise.all([
    getMyProfile(supabase, userId),
    getMyPlaces(supabase, userId),
    getMyBusyBlocks(supabase, userId),
    getMyQuietHours(supabase, userId),
  ]);
  const blocks: ScheduleBlock[] = rows.map((r) => ({
    ...toBlockSpec(r),
    id: r.id,
    source: r.source,
    movable: r.movable,
  }));
  // Séances d'étude acceptées et déplaçables sur lesquelles tombe autre chose (segment 14).
  let conflicts: ConflictView[] = [];
  if (rows.some((r) => r.source === "study" && r.movable)) {
    const r = await myStudyConflicts(supabaseStudyStore(supabase, userId), {
      userId,
      now: new Date(),
      travel: getTravelProvider(),
    }).catch((e: unknown) => {
      console.error("Conflits d'étude :", e);
      return null;
    });
    if (r?.ok) conflicts = r.value;
  }
  // Lieux des plans acceptés qui ne sont pas à moi (favori du groupe, lieu d'un ami).
  const mine = new Set(places.map((p) => p.id));
  const otherPlaceIds = [
    ...new Set(
      rows
        .filter((r) => r.source === "meetup" && r.place_id && !mine.has(r.place_id))
        .map((r) => r.place_id as string),
    ),
  ];
  const extraPlaceNames: Record<string, string> = {};
  if (otherPlaceIds.length > 0) {
    const { data: others } = await supabase
      .from("places")
      .select("id, name")
      .in("id", otherPlaceIds)
      .returns<{ id: string; name: string }[]>();
    for (const p of others ?? []) extraPlaceNames[p.id] = p.name;
  }
  const quiet = quietRow
    ? quietHoursFromDb(quietRow.unavailable_before, quietRow.unavailable_after)
    : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Mon horaire</h1>
          <p className="text-muted-foreground text-sm">
            Tes cours, ton travail et tes autres engagements. Les membres de tes groupes voient
            quand tu es occupé et où. Tes séances d&apos;étude se planifient dans{" "}
            <Link href="/etude" className="underline underline-offset-2">
              Étude
            </Link>
            . Les zones hachurées sont tes{" "}
            <Link href="/profil" className="underline underline-offset-2">
              heures où tu ne sors pas
            </Link>
            .
          </p>
          {places.length === 0 && (
            <p className="text-sm">
              Astuce : ajoute ton cégep dans{" "}
              <Link href="/lieux" className="underline underline-offset-2">
                Mes lieux
              </Link>{" "}
              pour y placer tes cours.
            </p>
          )}
        </header>
        <ScheduleEditor
          blocks={blocks}
          places={places.map((p) => ({ id: p.id, name: p.name }))}
          homeId={profile?.home_place_id ?? null}
          quiet={quiet}
          today={formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd")}
          actions={{ ajouterBlocs, modifierBloc, supprimerBloc }}
          icsActions={{ apercuIcs, confirmerIcs }}
          extraPlaceNames={extraPlaceNames}
          study={{
            start,
            conflicts,
            actions: { planifierEtude, replanifierConflits, verifierSeance, accepterSeances },
          }}
        />
      </main>
    </>
  );
}
