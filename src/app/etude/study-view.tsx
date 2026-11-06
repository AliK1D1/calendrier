"use client";

import { BookOpen, CalendarClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { type Flash, FlashMessage } from "@/components/flash-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions";
import { useI18n } from "@/lib/i18n/client";
import { formatDuration } from "@/lib/i18n/format";
import { DEFAULT_HOURS_BY_DIFFICULTY } from "@/lib/scheduling/studyPlanner";
import type { DeadlineKind, Difficulty } from "@/lib/scheduling/types";
import type { DeadlineView, StudyOverview } from "@/lib/study/service";
import { COURSE_MAX } from "@/lib/study/validation";
import { cn } from "@/lib/utils";

import { ACCEPTED_STUDY_COLOR, ConflictNotice } from "../horaire/study-panel";
import { ajouterEcheance, changerDeplacable, retirerSeance, supprimerEcheance } from "./actions";

/** Actions de la page (actions serveur ; remplaçables pour une page de démonstration). */
export interface StudyViewActions {
  ajouterEcheance: (input: unknown) => Promise<ActionResult>;
  supprimerEcheance: (id: unknown) => Promise<ActionResult>;
  retirerSeance: (id: unknown) => Promise<ActionResult>;
  changerDeplacable: (id: unknown, movable: unknown) => Promise<ActionResult>;
}

const DEFAULT_ACTIONS: StudyViewActions = {
  ajouterEcheance,
  supprimerEcheance,
  retirerSeance,
  changerDeplacable,
};

const SELECT =
  "border-input focus-visible:ring-ring/50 dark:bg-input/30 h-11 w-full sm:h-10 rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

export function StudyView({
  overview,
  today,
  actions = DEFAULT_ACTIONS,
}: {
  overview: StudyOverview;
  /** Aujourd'hui, `yyyy-MM-dd` (fuseau America/Toronto, calculé par le serveur). */
  today: string;
  actions?: StudyViewActions;
}) {
  const { t } = useI18n();
  const sv = t.study.view;
  const [flash, setFlash] = useState<Flash>(null);
  const clear = useCallback(() => setFlash(null), []);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, ok: string) => {
    setFlash(null);
    startTransition(async () => {
      const r = await fn();
      setFlash(r.ok ? { type: "ok", text: ok } : { type: "erreur", text: r.error });
    });
  };

  const upcoming = overview.deadlines.filter((d) => !d.past);
  const past = overview.deadlines.filter((d) => d.past);

  return (
    <div className="flex flex-col gap-6">
      <FlashMessage message={flash} onClose={clear} />

      <ConflictNotice
        conflicts={overview.conflicts}
        action={
          <Button asChild size="sm">
            <Link href="/horaire?etude=replanifier">{t.study.conflict.replan}</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="text-study size-5" aria-hidden /> {sv.planTitle}
          </CardTitle>
          <CardDescription>{sv.planDesc}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {overview.noHome ? (
            <p className="text-sm">
              {sv.noHomeBefore}
              <Link href="/lieux" className="underline underline-offset-2">
                {sv.noHomeLink}
              </Link>
              {sv.noHomeAfter}
            </p>
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground text-sm">{sv.addFirst}</p>
          ) : (
            <Button asChild className="sm:self-start">
              <Link href="/horaire?etude=planifier">
                <CalendarClock /> {sv.planTitle}
              </Link>
            </Button>
          )}
          <p className="text-muted-foreground text-xs">
            {sv.prefsBefore}
            <Link href="/profil#etude" className="underline underline-offset-2">
              {sv.prefsLink}
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{sv.addTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <DeadlineForm
            today={today}
            disabled={pending}
            onSubmit={(value, reset) => {
              setFlash(null);
              startTransition(async () => {
                const r = await actions.ajouterEcheance(value);
                if (r.ok) {
                  reset();
                  setFlash({
                    type: "ok",
                    text: sv.added(t.study.kinds[value.kind]),
                  });
                } else setFlash({ type: "erreur", text: r.error });
              });
            }}
          />
        </CardContent>
      </Card>

      <section aria-labelledby="a-venir" className="flex flex-col gap-3">
        <h2 id="a-venir" className="text-lg font-semibold">
          {sv.upcoming}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            {sv.noUpcoming}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((d) => (
              <DeadlineItem key={d.id} d={d} pending={pending} run={run} actions={actions} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="text-lg font-semibold">{sv.past(past.length)}</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {past.map((d) => (
              <DeadlineItem key={d.id} d={d} pending={pending} run={run} actions={actions} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DeadlineItem({
  d,
  pending,
  run,
  actions,
}: {
  d: DeadlineView;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>, ok: string) => void;
  actions: StudyViewActions;
}) {
  const { locale, t } = useI18n();
  const sv = t.study.view;
  const upcomingSessions = d.sessions.filter((s) => !s.past);
  return (
    <li className={cn("bg-card flex flex-col gap-2 rounded-lg border p-3", d.past && "opacity-80")}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span className="font-medium break-words">
            <Badge variant="secondary" className="mr-1.5">
              {t.study.kinds[d.kind]}
            </Badge>
            {d.course}
          </span>
          <span>{d.dueLabel}</span>
          <span className="text-muted-foreground text-xs">
            {sv.toPlan(formatDuration(d.requiredMinutes, locale))}
            {d.estimated
              ? sv.yourEstimate
              : ` (${t.study.difficulty[d.difficulty].toLowerCase()})`}{" "}
            · {sv.inSchedule(formatDuration(d.acceptedMinutes, locale))}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={sv.deleteLabel(d.course)}
          onClick={() => {
            if (window.confirm(sv.deleteConfirm(d.course, d.sessions.length))) {
              run(() => actions.supprimerEcheance(d.id), sv.deleted);
            }
          }}
        >
          <Trash2 /> <span className="sr-only sm:not-sr-only">{sv.delete}</span>
        </Button>
      </div>
      {upcomingSessions.length > 0 && (
        <details>
          <summary className="text-sm">{sv.acceptedUpcoming(upcomingSessions.length)}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {upcomingSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={cn("size-3 shrink-0 rounded-full border-2", ACCEPTED_STUDY_COLOR)}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  {s.label} · {s.placeName}
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={s.movable}
                    disabled={pending}
                    onChange={(e) =>
                      run(
                        () => actions.changerDeplacable(s.id, e.target.checked),
                        e.target.checked ? sv.nowMovable : sv.nowFixed,
                      )
                    }
                  />
                  {sv.movable}
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  aria-label={sv.removeLabel(s.label)}
                  onClick={() => run(() => actions.retirerSeance(s.id), sv.removed)}
                >
                  {sv.remove}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

interface DeadlineFormValue {
  kind: DeadlineKind;
  course: string;
  date: string;
  time: string;
  hours: string;
  difficulty: Difficulty;
}

function DeadlineForm({
  today,
  disabled,
  onSubmit,
}: {
  today: string;
  disabled: boolean;
  onSubmit: (value: DeadlineFormValue, reset: () => void) => void;
}) {
  const empty: DeadlineFormValue = {
    kind: "exam",
    course: "",
    date: "",
    time: "09:00",
    hours: "",
    difficulty: 2,
  };
  const { t } = useI18n();
  const ff = t.study.form;
  const [v, setV] = useState<DeadlineFormValue>(empty);
  const set = <K extends keyof DeadlineFormValue>(k: K, value: DeadlineFormValue[K]) =>
    setV((old) => ({ ...old, [k]: value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v, () => setV(empty));
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{ff.type}</legend>
        <div className="grille-4-demi">
          {(["exam", "assignment"] as const).map((k) => (
            <label
              key={k}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-md border text-sm",
                v.kind === k && "border-primary bg-primary/10 font-medium",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={v.kind === k}
                onChange={() => set("kind", k)}
                className="sr-only"
              />
              {k === "exam" ? ff.exam : ff.assignment}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cours">{ff.course}</Label>
        <Input
          id="cours"
          value={v.course}
          onChange={(e) => set("course", e.target.value)}
          maxLength={COURSE_MAX}
          placeholder={ff.coursePlaceholder}
          required
        />
      </div>
      <div className="grille-4-demi">
        <div className="flex flex-col gap-2">
          <Label htmlFor="date">{v.kind === "exam" ? ff.examDate : ff.dueDate}</Label>
          <Input
            id="date"
            type="date"
            min={today}
            value={v.date}
            onChange={(e) => set("date", e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="heure">{ff.time}</Label>
          <Input
            id="heure"
            type="time"
            step={900}
            value={v.time}
            onChange={(e) => set("time", e.target.value)}
            required
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="heures">{ff.hours}</Label>
          <Input
            id="heures"
            type="number"
            inputMode="decimal"
            min={0.5}
            max={60}
            step={0.5}
            value={v.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder={ff.hoursPlaceholder}
            aria-describedby="heures-aide"
          />
          <p id="heures-aide" className="text-muted-foreground text-xs">
            {ff.hoursHelp}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="difficulte">{ff.difficulty}</Label>
          <select
            id="difficulte"
            className={SELECT}
            value={v.difficulty}
            onChange={(e) => set("difficulty", Number(e.target.value) as Difficulty)}
          >
            {([1, 2, 3] as const).map((n) => (
              <option key={n} value={n}>
                {t.study.difficulty[n]} ({DEFAULT_HOURS_BY_DIFFICULTY[n]} h)
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" disabled={disabled} className="sm:self-start">
        {disabled ? ff.saving : ff.add}
      </Button>
    </form>
  );
}
