import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { toBlockSpec } from "@/lib/db/convert";
import { getMyBusyBlocks, getMyPlaces, getMyProfile, getMyQuietHours } from "@/lib/profile";
import { toHHmm } from "@/lib/db/convert";
import { dayLabel } from "@/lib/meetups/search";
import { availabilityLabel } from "@/lib/scheduling/oneOffAvailability";
import { quietHoursFromDb } from "@/lib/scheduling/quietHours";
import { TIME_ZONE, zonedTime } from "@/lib/scheduling/time";
import { parseClock, shiftDay } from "@/lib/scheduling/weeklyBlocks";
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
import { ajouterDisponibilite, supprimerDisponibilite } from "./availability-actions";
import { type AvailabilityItem, AvailabilityPanel } from "./availability-panel";
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

  // Disponibilités ponctuelles à venir (segment 18). Table absente : migration 0012 manquante.
  const today = formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd");
  const { data: slotRows, error: slotError } = await supabase
    .from("availability_slots")
    .select("id, day, start_time, end_time, note")
    .eq("owner_id", userId)
    .gte("day", today)
    .order("day")
    .order("start_time")
    .returns<{ id: string; day: string; start_time: string; end_time: string; note: string }[]>();
  if (slotError) console.error("Disponibilités :", slotError.code, slotError.message);
  const availabilities: AvailabilityItem[] = (slotRows ?? []).map((r) => ({
    id: r.id,
    dayLabel: dayLabel(zonedTime(r.day, "12:00")),
    timeLabel: availabilityLabel(
      parseClock(toHHmm(r.start_time)) ?? 0,
      parseClock(toHHmm(r.end_time)) ?? 0,
    ),
    note: r.note,
  }));

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
          today={today}
          actions={{ ajouterBlocs, modifierBloc, supprimerBloc }}
          icsActions={{ apercuIcs, confirmerIcs }}
          extraPlaceNames={extraPlaceNames}
          study={{
            start,
            conflicts,
            actions: { planifierEtude, replanifierConflits, verifierSeance, accepterSeances },
          }}
        />
        <AvailabilityPanel
          items={availabilities}
          today={today}
          lastDay={shiftDay(today, 365)}
          unavailable={
            slotError
              ? "Les disponibilités ponctuelles demandent la migration supabase/migration-0012.sql (voir README)."
              : null
          }
          actions={{ ajouter: ajouterDisponibilite, supprimer: supprimerDisponibilite }}
        />
      </main>
    </>
  );
}
