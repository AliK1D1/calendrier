"use client";

import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, Check, Eye, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { formatDuration } from "@/lib/i18n/format";
import type { ConflictView, SessionView, StudyPlanView } from "@/lib/study/service";
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
  const { t } = useI18n();
  if (conflicts.length === 0) return null;
  const c = t.study.conflict;
  return (
    <section
      aria-labelledby="conflit-etude"
      className="border-warning/60 bg-warning/15 flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <h2 id="conflit-etude" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {c.title(conflicts.length)}
      </h2>
      <p>{c.body(conflicts.length)}</p>
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
            {pending ? c.computing : c.replan}
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
  const { locale, t, tr } = useI18n();
  const p = t.study.panel;
  const total = plan.sessions.reduce((t, s) => t + (s.endMinute - s.startMinute), 0);
  const replan = plan.mode === "replan";
  const keys = plan.sessions.map((s) => s.key);
  return (
    <section aria-labelledby="seances-proposees" className="rangee flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-col gap-1">
        <h2 id="seances-proposees" className="titre-section flex items-center gap-2">
          <BookOpen className="text-study size-5 shrink-0" aria-hidden />
          {replan ? p.titleReplan : p.titlePlan}
        </h2>
        {plan.sessions.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {p.summary(plan.sessions.length, formatDuration(total, locale))}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{p.none}</p>
        )}
      </div>

      {plan.warnings.length > 0 && (
        <ul className="border-warning/60 bg-warning/15 flex flex-col gap-1 rounded-md border p-3 text-sm">
          {plan.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{tr(w)}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.sessions.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onAccept(keys)}>
              <Check /> {replan ? p.moveAll : p.acceptAll}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRefuse(keys)}>
              <X /> {p.refuseAll}
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
                    aria-label={p.earlier(`${s.title}, ${s.label}`)}
                    onClick={() => onNudge(s.key, -15)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={p.later(`${s.title}, ${s.label}`)}
                    onClick={() => onNudge(s.key, 15)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={p.show(`${s.title}, ${s.label}`)}
                    onClick={() => onShow(s)}
                  >
                    <Eye />
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onAccept([s.key])}
                    aria-label={`${replan ? p.move : p.accept} ${s.title}, ${s.label}`}
                  >
                    {replan ? p.move : p.accept}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRefuse([s.key])}
                    aria-label={`${p.refuse} ${s.title}, ${s.label}`}
                  >
                    {p.refuse}
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
