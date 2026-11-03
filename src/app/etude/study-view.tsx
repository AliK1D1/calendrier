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
import { DEFAULT_HOURS_BY_DIFFICULTY, formatStudyDuration } from "@/lib/scheduling/studyPlanner";
import type { DeadlineKind, Difficulty } from "@/lib/scheduling/types";
import type { DeadlineView, StudyOverview } from "@/lib/study/service";
import { COURSE_MAX, DEADLINE_KIND_LABELS, DIFFICULTY_LABELS } from "@/lib/study/validation";
import { plural } from "@/lib/ux/plural";
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
  "border-input focus-visible:ring-ring/50 dark:bg-input/30 h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

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
            <Link href="/horaire?etude=replanifier">Replanifier</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="text-study size-5" aria-hidden /> Planifier mon étude
          </CardTitle>
          <CardDescription>
            Les séances proposées s&apos;affichent dans ton horaire, en pointillé. Rien n&apos;est
            ajouté avant que tu acceptes ; tu peux les déplacer ou les refuser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {overview.noHome ? (
            <p className="text-sm">
              Choisis d&apos;abord ta maison dans{" "}
              <Link href="/lieux" className="underline underline-offset-2">
                Mes lieux
              </Link>{" "}
              : les séances ont lieu là où tu es déjà, ou chez toi.
            </p>
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Ajoute un examen ou un travail ci-dessous pour commencer.
            </p>
          ) : (
            <Button asChild className="sm:self-start">
              <Link href="/horaire?etude=planifier">
                <CalendarClock /> Planifier mon étude
              </Link>
            </Button>
          )}
          <p className="text-muted-foreground text-xs">
            Durée des séances, maximum par jour et heures d&apos;étude :{" "}
            <Link href="/profil#etude" className="underline underline-offset-2">
              préférences d&apos;étude
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter un examen ou un travail</CardTitle>
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
                    text: `${DEADLINE_KIND_LABELS[value.kind]} ajouté. Touche « Planifier mon étude » pour voir les séances.`,
                  });
                } else setFlash({ type: "erreur", text: r.error });
              });
            }}
          />
        </CardContent>
      </Card>

      <section aria-labelledby="a-venir" className="flex flex-col gap-3">
        <h2 id="a-venir" className="text-lg font-semibold">
          À venir
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            Aucun examen ni travail à venir.
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
          <summary className="text-lg font-semibold">Passés ({past.length})</summary>
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
  const upcomingSessions = d.sessions.filter((s) => !s.past);
  return (
    <li className={cn("bg-card flex flex-col gap-2 rounded-lg border p-3", d.past && "opacity-80")}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span className="font-medium break-words">
            <Badge variant="secondary" className="mr-1.5">
              {DEADLINE_KIND_LABELS[d.kind]}
            </Badge>
            {d.course}
          </span>
          <span>{d.dueLabel}</span>
          <span className="text-muted-foreground text-xs">
            {formatStudyDuration(d.requiredMinutes)} à prévoir
            {d.estimated
              ? " (ton estimation)"
              : ` (${DIFFICULTY_LABELS[d.difficulty].toLowerCase()})`}{" "}
            · {formatStudyDuration(d.acceptedMinutes)} dans ton horaire
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Supprimer ${d.course}`}
          onClick={() => {
            const extra =
              d.sessions.length > 0
                ? `\nSes ${plural(d.sessions.length, "séance", "séances")} d'étude seront retirées de ton horaire.`
                : "";
            if (window.confirm(`Supprimer « ${d.course} » ?${extra}`)) {
              run(() => actions.supprimerEcheance(d.id), "Supprimé.");
            }
          }}
        >
          <Trash2 /> <span className="sr-only sm:not-sr-only">Supprimer</span>
        </Button>
      </div>
      {upcomingSessions.length > 0 && (
        <details>
          <summary className="text-sm">
            {plural(
              upcomingSessions.length,
              "séance acceptée à venir",
              "séances acceptées à venir",
            )}
          </summary>
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
                        e.target.checked ? "Séance déplaçable." : "Séance fixe.",
                      )
                    }
                  />
                  Déplaçable
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  aria-label={`Retirer la séance du ${s.label}`}
                  onClick={() => run(() => actions.retirerSeance(s.id), "Séance retirée.")}
                >
                  Retirer
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
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="grid grid-cols-2 gap-2">
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
              {k === "exam" ? "Examen" : "Travail à remettre"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cours">Cours</Label>
        <Input
          id="cours"
          value={v.course}
          onChange={(e) => set("course", e.target.value)}
          maxLength={COURSE_MAX}
          placeholder="ex. Chimie générale"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="date">{v.kind === "exam" ? "Date de l'examen" : "Date de remise"}</Label>
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
          <Label htmlFor="heure">Heure</Label>
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
          <Label htmlFor="heures">Heures d&apos;étude estimées</Label>
          <Input
            id="heures"
            type="number"
            inputMode="decimal"
            min={0.5}
            max={60}
            step={0.5}
            value={v.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="Je ne sais pas"
            aria-describedby="heures-aide"
          />
          <p id="heures-aide" className="text-muted-foreground text-xs">
            Laisse vide si tu ne sais pas : on se fie à la difficulté.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="difficulte">Difficulté</Label>
          <select
            id="difficulte"
            className={SELECT}
            value={v.difficulty}
            onChange={(e) => set("difficulty", Number(e.target.value) as Difficulty)}
          >
            {([1, 2, 3] as const).map((n) => (
              <option key={n} value={n}>
                {DIFFICULTY_LABELS[n]} ({DEFAULT_HOURS_BY_DIFFICULTY[n]} h)
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" disabled={disabled} className="sm:self-start">
        {disabled ? "Enregistrement…" : "Ajouter"}
      </Button>
    </form>
  );
}
