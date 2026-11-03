"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatStudyDuration } from "@/lib/scheduling/studyPlanner";
import type { StudyPreferences } from "@/lib/scheduling/types";
import { formatClock, formatClockFr, parseClock } from "@/lib/scheduling/weeklyBlocks";
import {
  BREAK_CHOICES,
  DAY_MAX_CHOICES,
  KEEP_FREE_CHOICES,
  SESSION_LENGTH_CHOICES,
} from "@/lib/study/validation";

import { enregistrerPreferencesEtude } from "../etude/actions";

const SELECT =
  "border-input focus-visible:ring-ring/50 dark:bg-input/30 h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

/** Liste triée qui contient toujours la valeur actuelle. */
const withCurrent = (list: readonly number[], current: number) =>
  [...new Set([...list, current])].sort((a, b) => a - b);

const HOURS = Array.from({ length: 49 }, (_, i) => i * 30);

/** Préférences d'étude : durée des séances, maximum par jour, pause, heures, veille, soirées. */
export function StudyPrefsForm({ prefs }: { prefs: StudyPreferences }) {
  const [minSession, setMinSession] = useState(prefs.minSessionMinutes);
  const [maxSession, setMaxSession] = useState(prefs.maxSessionMinutes);
  const [maxPerDay, setMaxPerDay] = useState(prefs.maxStudyMinutesPerDay);
  const [breakMinutes, setBreak] = useState(prefs.breakMinutes);
  const [studyStart, setStart] = useState(prefs.studyHours.start);
  const [studyEnd, setEnd] = useState(prefs.studyHours.end);
  const [eveCutoff, setEve] = useState(prefs.eveCutoff ?? "");
  const [keepFree, setKeep] = useState(Math.round(prefs.keepFreeRatio * 100));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const hourOptions = (current: string) =>
    withCurrent(HOURS, parseClock(current) ?? 0).map((m) => (
      <option key={m} value={formatClock(m)}>
        {formatClockFr(m)}
      </option>
    ));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const r = await enregistrerPreferencesEtude({
            minSession,
            maxSession,
            maxPerDay,
            breakMinutes,
            studyStart,
            studyEnd,
            eveCutoff,
            keepFreePercent: keepFree,
          });
          setMessage(
            r.ok ? { ok: true, text: "Préférences enregistrées." } : { ok: false, text: r.error },
          );
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seance-min">Séance d&apos;au moins</Label>
          <select
            id="seance-min"
            className={SELECT}
            value={minSession}
            onChange={(e) => setMinSession(Number(e.target.value))}
          >
            {withCurrent(
              SESSION_LENGTH_CHOICES.filter((m) => m <= 120),
              minSession,
            ).map((m) => (
              <option key={m} value={m}>
                {formatStudyDuration(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seance-max">Séance d&apos;au plus</Label>
          <select
            id="seance-max"
            className={SELECT}
            value={maxSession}
            onChange={(e) => setMaxSession(Number(e.target.value))}
          >
            {withCurrent(SESSION_LENGTH_CHOICES, maxSession).map((m) => (
              <option key={m} value={m}>
                {formatStudyDuration(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="max-jour">Au plus par jour</Label>
          <select
            id="max-jour"
            className={SELECT}
            value={maxPerDay}
            onChange={(e) => setMaxPerDay(Number(e.target.value))}
          >
            {withCurrent(DAY_MAX_CHOICES, maxPerDay).map((m) => (
              <option key={m} value={m}>
                {formatStudyDuration(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pause">Pause entre deux séances</Label>
          <select
            id="pause"
            className={SELECT}
            value={breakMinutes}
            onChange={(e) => setBreak(Number(e.target.value))}
          >
            {withCurrent(BREAK_CHOICES, breakMinutes).map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Aucune" : formatStudyDuration(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="etude-debut">J&apos;étudie à partir de</Label>
          <select
            id="etude-debut"
            className={SELECT}
            value={studyStart}
            onChange={(e) => setStart(e.target.value)}
          >
            {hourOptions(studyStart)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="etude-fin">Et jusqu&apos;à</Label>
          <select
            id="etude-fin"
            className={SELECT}
            value={studyEnd}
            onChange={(e) => setEnd(e.target.value)}
          >
            {hourOptions(studyEnd)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="veille">La veille d&apos;un examen, pas après</Label>
          <select
            id="veille"
            className={SELECT}
            value={eveCutoff}
            onChange={(e) => setEve(e.target.value)}
          >
            <option value="">Pas de limite</option>
            {withCurrent(
              HOURS.filter((m) => m >= 17 * 60 && m < 24 * 60),
              parseClock(eveCutoff || "21:00") ?? 21 * 60,
            ).map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockFr(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="garder-libre">Soirées et fins de semaine : garder libre</Label>
          <select
            id="garder-libre"
            className={SELECT}
            value={keepFree}
            onChange={(e) => setKeep(Number(e.target.value))}
          >
            {withCurrent(KEEP_FREE_CHOICES, keepFree).map((p) => (
              <option key={p} value={p}>
                {p === 0 ? "Rien de spécial" : `Au moins ${p} %`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-success text-sm" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? "Enregistrement…" : "Enregistrer ces préférences"}
      </Button>
    </form>
  );
}
