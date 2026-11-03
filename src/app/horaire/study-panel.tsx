"use client";

import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, Check, Eye, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatStudyDuration } from "@/lib/scheduling/studyPlanner";
import type { ConflictView, SessionView, StudyPlanView } from "@/lib/study/service";
import { plural } from "@/lib/ux/plural";
import { cn } from "@/lib/utils";

/** Style d'une séance proposée : pointillé, couleur « étude » (claire et sombre). */
export const PROPOSED_STUDY_COLOR =
  "border-2 border-dashed border-study bg-study/10 text-foreground dark:bg-study/15";
/** Style d'une séance acceptée : plein, même couleur. */
export const ACCEPTED_STUDY_COLOR = "border-study bg-study/15 text-foreground dark:bg-study/25";

/** « Séance en conflit : replanifier ? » (/horaire et /etude). */
export function ConflictNotice({
  conflicts,
  onReplan,
  pending,
  action,
}: {
  conflicts: ConflictView[];
  onReplan?: () => void;
  pending?: boolean;
  /** À la place du bouton (ex. lien vers /horaire). */
  action?: React.ReactNode;
}) {
  if (conflicts.length === 0) return null;
  return (
    <section
      aria-labelledby="conflit-etude"
      className="border-warning/60 bg-warning/15 flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <h2 id="conflit-etude" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {conflicts.length > 1
          ? "Séances en conflit : replanifier ?"
          : "Séance en conflit : replanifier ?"}
      </h2>
      <p>
        Autre chose tombe maintenant sur{" "}
        {conflicts.length > 1
          ? "ces séances d'étude déplaçables"
          : "cette séance d'étude déplaçable"}{" "}
        (un plan de groupe, un cours ou le trajet pour y aller) :
      </p>
      <ul className="list-disc pl-5">
        {conflicts.map((c) => (
          <li key={c.id}>
            {c.title}, {c.label}
          </li>
        ))}
      </ul>
      <div>
        {action ?? (
          <Button size="sm" onClick={onReplan} disabled={pending}>
            {pending ? "Calcul…" : "Replanifier"}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Panneau des séances proposées : avertissements, tout accepter, une à une. */
export function StudyPanel({
  plan,
  busy,
  errorKey,
  onAccept,
  onRefuse,
  onNudge,
  onShow,
}: {
  plan: StudyPlanView;
  /** Une action est en cours (boutons désactivés). */
  busy: boolean;
  /** Séance refusée par la dernière vérification (mise en évidence). */
  errorKey: string | null;
  onAccept: (keys: string[]) => void;
  onRefuse: (keys: string[]) => void;
  onNudge: (key: string, minutes: number) => void;
  onShow: (s: SessionView) => void;
}) {
  const total = plan.sessions.reduce((t, s) => t + (s.endMinute - s.startMinute), 0);
  const replan = plan.mode === "replan";
  const keys = plan.sessions.map((s) => s.key);
  return (
    <section
      aria-labelledby="seances-proposees"
      className="bg-card flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="seances-proposees" className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="text-study size-5 shrink-0" aria-hidden />
          {replan ? "Nouvelles places proposées" : "Séances d'étude proposées"}
        </h2>
        {plan.sessions.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {plural(plan.sessions.length, "séance", "séances")}, {formatStudyDuration(total)} en
            tout, en pointillé dans la grille. Rien n&apos;est ajouté à ton horaire avant que tu
            acceptes. Glisse une séance dans la grille (ou utilise les flèches) pour la déplacer.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Aucune séance à proposer.</p>
        )}
      </div>

      {plan.warnings.length > 0 && (
        <ul className="border-warning/60 bg-warning/15 flex flex-col gap-1 rounded-md border p-3 text-sm">
          {plan.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.sessions.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onAccept(keys)}>
              <Check /> {replan ? "Tout déplacer" : "Tout accepter"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRefuse(keys)}>
              <X /> Tout refuser
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {plan.sessions.map((s) => (
              <li
                key={s.key}
                id={`proposition-${s.key}`}
                className={cn(
                  "flex flex-col gap-2 rounded-md border p-2.5 text-sm sm:flex-row sm:items-center",
                  errorKey === s.key && "border-destructive",
                )}
              >
                <span
                  className={cn(
                    "hidden size-3 shrink-0 rounded-full sm:block",
                    PROPOSED_STUDY_COLOR,
                  )}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{s.title}</span>
                  <span>
                    {s.label} · {s.placeName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${s.title}, ${s.label} : 15 minutes plus tôt`}
                    onClick={() => onNudge(s.key, -15)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${s.title}, ${s.label} : 15 minutes plus tard`}
                    onClick={() => onNudge(s.key, 15)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Voir ${s.title}, ${s.label}, dans la grille`}
                    onClick={() => onShow(s)}
                  >
                    <Eye />
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onAccept([s.key])}
                    aria-label={`${replan ? "Déplacer" : "Accepter"} ${s.title}, ${s.label}`}
                  >
                    {replan ? "Déplacer" : "Accepter"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRefuse([s.key])}
                    aria-label={`Refuser ${s.title}, ${s.label}`}
                  >
                    Refuser
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
