"use client";

import { BookOpen, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { type Flash, FlashMessage } from "@/components/flash-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_GRID_RANGE, layoutDay, selectionFromDrag } from "@/lib/scheduling/weekGrid";
import type { SessionView } from "@/lib/study/service";
import {
  blocksOnDay,
  formatClock,
  isRecurring,
  repeatLabel,
  shiftDay,
  suggestSession,
  type Weekday,
  weekDays,
  weekdayOf,
  weekStart,
} from "@/lib/scheduling/weeklyBlocks";
import { cn } from "@/lib/utils";
import {
  type LegendKind,
  legendIsEmpty,
  type ScheduleLegend,
  scheduleLegend,
} from "@/lib/ux/scheduleLegend";
import { dayColorStyle } from "@/lib/ux/dayColors";

import { BlockDialog, type BlockDraft } from "./block-dialog";
import { IcsImport } from "./ics-import";
import {
  ACCEPTED_STUDY_COLOR,
  ConflictNotice,
  PROPOSED_STUDY_COLOR,
  StudyPanel,
} from "./study-panel";
import type { ScheduleBlock, ScheduleEditorProps } from "./types";
import { useStudyPlan } from "./use-study-plan";
import { useI18n } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import {
  type DatePattern,
  formatClockLocale,
  formatDay,
  weekdayLong,
  weekdayShort,
} from "@/lib/i18n/format";

const RANGE = DEFAULT_GRID_RANGE;
const HOURS = Array.from(
  { length: (RANGE.end - RANGE.start) / 60 + 1 },
  (_, i) => RANGE.start + i * 60,
);

/** Couleurs des blocs, une par lieu (même lieu = même couleur). */
const COLORS = [
  "bg-sky-100 border-sky-400 text-sky-950 dark:bg-sky-950 dark:text-sky-50",
  "bg-emerald-100 border-emerald-400 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50",
  "bg-violet-100 border-violet-400 text-violet-950 dark:bg-violet-950 dark:text-violet-50",
  "bg-amber-100 border-amber-400 text-amber-950 dark:bg-amber-950 dark:text-amber-50",
  "bg-rose-100 border-rose-400 text-rose-950 dark:bg-rose-950 dark:text-rose-50",
  "bg-teal-100 border-teal-400 text-teal-950 dark:bg-teal-950 dark:text-teal-50",
];

/** Couleur des plans de groupe acceptés (lecture seule). */
const MEETUP_COLOR = "bg-primary/15 border-primary text-foreground";
/** Temps occupé lu dans Outlook (lecture seule). */
const OUTLOOK_COLOR = "bg-muted border-muted-foreground/60 text-foreground";
/** Calendrier abonné qui compte comme occupé (lecture seule). */
const SUBSCRIPTION_BUSY_COLOR =
  "bg-indigo-100 border-indigo-400 text-indigo-950 dark:bg-indigo-950 dark:text-indigo-50";
/** Calendrier abonné « juste pour voir » : n'occupe pas (bordure pointillée, fond léger). */
const SUBSCRIPTION_INFO_COLOR =
  "bg-background/80 border border-dashed border-indigo-400 text-muted-foreground";

/** Couleur d'un bloc en lecture seule (plan, étude, Outlook, abonnement), sinon `fallback`. */
function sourceColor(b: ScheduleBlock, fallback: string): string {
  if (b.source === "meetup") return MEETUP_COLOR;
  if (b.source === "study") return ACCEPTED_STUDY_COLOR;
  if (b.source === "outlook") return OUTLOOK_COLOR;
  if (b.source === "subscription") {
    return b.subscription?.countsAsBusy === false
      ? SUBSCRIPTION_INFO_COLOR
      : SUBSCRIPTION_BUSY_COLOR;
  }
  return fallback;
}

/** Position d'un pointeur dans une colonne : fraction de la hauteur (0 = 7 h, 1 = 23 h). */
function fractionIn(el: HTMLElement, clientY: number): number {
  const r = el.getBoundingClientRect();
  return (clientY - r.top) / r.height;
}

/** Un élément de la grille : un bloc enregistré, ou une séance d'étude proposée. */
interface GridItem {
  id: string;
  startMinute: number;
  endMinute: number;
  block?: ScheduleBlock;
  proposal?: SessionView;
}

/** Séance proposée en train d'être glissée. */
interface Moving {
  key: string;
  x0: number;
  y0: number;
  /** Hauteur de la colonne en pixels (pour convertir le déplacement en minutes). */
  px: number;
  dayFrom: string;
  startFrom: number;
  duration: number;
  day: string;
  startMinute: number;
  moved: boolean;
}

interface Drag {
  day: string;
  from: number;
  to: number;
  pointerType: string;
  x: number;
  y: number;
  moved: boolean;
}

export function ScheduleEditor({
  blocks,
  places,
  homeId,
  quiet,
  today,
  actions,
  icsActions,
  extraPlaceNames,
  study,
}: ScheduleEditorProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const ts = t.schedule;
  const clock = (m: number) => formatClockLocale(m, locale);
  const dayLabel = (day: string, pattern: DatePattern) => formatDay(day, pattern, locale);
  const [monday, setMonday] = useState(() => weekStart(today));
  const days = useMemo(() => weekDays(monday), [monday]);
  const [selectedDay, setSelectedDay] = useState(today);
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0];
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [studyFlash, setStudyFlash] = useState<Flash>(null);
  const flash = useMemo<Flash>(
    () => studyFlash ?? (message ? { type: "ok", text: message } : null),
    [message, studyFlash],
  );
  const clearMessage = useCallback(() => {
    setMessage(null);
    setStudyFlash(null);
  }, []);
  const showSession = useCallback((s: SessionView) => {
    setMonday(weekStart(s.day));
    setSelectedDay(s.day);
    document
      .getElementById("grille-horaire")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const studyPlan = useStudyPlan(study, { onFlash: setStudyFlash, onShow: showSession });
  const [moving, setMoving] = useState<Moving | null>(null);
  const conflictIds = useMemo(() => new Set(study?.conflicts.map((c) => c.id)), [study]);
  // Séances proposées affichées (celle qu'on glisse, à sa position du moment).
  const proposals = useMemo<SessionView[]>(
    () =>
      (studyPlan.plan?.sessions ?? []).map((s) =>
        moving && s.key === moving.key
          ? {
              ...s,
              day: moving.day,
              startMinute: moving.startMinute,
              endMinute: moving.startMinute + moving.duration,
            }
          : s,
      ),
    [studyPlan.plan, moving],
  );

  const placeName = useMemo(
    () =>
      new Map([
        ...Object.entries(extraPlaceNames ?? {}),
        ...places.map((p) => [p.id, p.name] as const),
      ]),
    [places, extraPlaceNames],
  );
  const colorOf = useMemo(() => {
    const ids = [homeId ?? "", ...places.map((p) => p.id).filter((id) => id !== homeId)];
    return (placeId: string | null) =>
      COLORS[Math.max(0, ids.indexOf(placeId ?? homeId ?? "")) % COLORS.length];
  }, [places, homeId]);
  const placeLabel = (placeId: string | null) => (placeId && placeName.get(placeId)) || ts.home;

  const session = useMemo(() => suggestSession(blocks, today), [blocks, today]);
  const defaultPlace = useMemo(() => {
    // Le lieu le plus utilisé dans mon horaire (souvent le cégep), sinon mon premier lieu.
    const counts = new Map<string, number>();
    for (const b of blocks) if (b.placeId) counts.set(b.placeId, (counts.get(b.placeId) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best && placeName.has(best)) return best;
    return places.find((p) => p.id !== homeId)?.id ?? null;
  }, [blocks, places, homeId, placeName]);

  function newDraft(day: string, startMinute: number, endMinute: number): BlockDraft {
    return {
      title: "",
      placeId: defaultPlace,
      start: formatClock(startMinute),
      end: formatClock(endMinute),
      kind: "weekly",
      weekdays: [weekdayOf(day)],
      date: day,
      sessionStart: session.from,
      sessionEnd: session.to,
      ...CUSTOM_DEFAULTS,
    };
  }

  function editDraft(b: ScheduleBlock, day: string): BlockDraft {
    const custom = b.repeatUnit != null;
    return {
      id: b.id,
      title: b.title,
      placeId: b.placeId,
      start: formatClock(b.startMinute),
      end: formatClock(b.endMinute),
      kind: custom ? "custom" : b.weekday == null ? "once" : "weekly",
      weekdays: b.weekday == null ? [weekdayOf(day)] : [b.weekday],
      date: b.weekday == null ? (b.validFrom ?? day) : day,
      sessionStart: b.validFrom ?? session.from,
      sessionEnd: b.validUntil ?? (custom ? "" : session.to),
      ...CUSTOM_DEFAULTS,
      ...(custom && {
        repeatEvery: String(b.repeatEvery ?? 1),
        repeatUnit: b.repeatUnit ?? "week",
        repeatEnd: b.validUntil ? "date" : "never",
      }),
    };
  }

  // ─── Clic-glisser (souris) et toucher (téléphone) sur une colonne ──────────────────────
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, day: string) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const f = fractionIn(e.currentTarget, e.clientY);
    // Souris : on capture pour suivre le glissé. Doigt : on laisse défiler la page.
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      day,
      from: f,
      to: f,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8;
    if (drag.pointerType !== "mouse") {
      // Au doigt, un mouvement = défilement : on annule la création.
      if (moved) setDrag(null);
      return;
    }
    setDrag({ ...drag, to: fractionIn(e.currentTarget, e.clientY), moved });
  }

  function openFromDrag(d: Drag) {
    const sel = selectionFromDrag(d.from, d.moved ? d.to : d.from, RANGE);
    setDrag(null);
    setMessage(null);
    setDraft(newDraft(d.day, sel.startMinute, sel.endMinute));
  }

  // Souris : on ouvre au relâchement. Doigt : on attend le « click » qui suit le toucher,
  // sinon ce click tomberait dans le formulaire tout juste ouvert sous le doigt.
  function onPointerUp() {
    if (drag?.pointerType === "mouse") openFromDrag(drag);
  }

  function onClick() {
    if (drag && drag.pointerType !== "mouse") openFromDrag(drag);
  }

  // ─── Glisser une séance proposée (souris ou doigt) ─────────────────────────────────────
  function onProposalPointerDown(e: React.PointerEvent<HTMLButtonElement>, s: SessionView) {
    if (e.button !== 0 || studyPlan.busy) return;
    e.stopPropagation();
    const column = e.currentTarget.parentElement;
    if (!column) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setMoving({
      key: s.key,
      x0: e.clientX,
      y0: e.clientY,
      px: column.getBoundingClientRect().height,
      dayFrom: s.day,
      startFrom: s.startMinute,
      duration: s.endMinute - s.startMinute,
      day: s.day,
      startMinute: s.startMinute,
      moved: false,
    });
  }

  function onProposalPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!moving) return;
    const moved = moving.moved || Math.hypot(e.clientX - moving.x0, e.clientY - moving.y0) > 6;
    const delta = Math.round((((e.clientY - moving.y0) / moving.px) * span) / 15) * 15;
    const startMinute = Math.min(
      Math.max(moving.startFrom + delta, RANGE.start),
      RANGE.end - moving.duration,
    );
    // Ordinateur : on peut changer de jour (colonne sous le pointeur).
    const column = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.day);
    setMoving({ ...moving, startMinute, day: column?.dataset.day ?? moving.day, moved });
  }

  function onProposalPointerUp() {
    if (!moving) return;
    const m = moving;
    setMoving(null);
    if (!m.moved) {
      document
        .getElementById(`proposition-${m.key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (m.day !== m.dayFrom || m.startMinute !== m.startFrom) {
      void studyPlan.move(m.key, m.day, m.startMinute);
    }
  }

  const preview =
    drag && drag.pointerType === "mouse" && drag.moved
      ? selectionFromDrag(drag.from, drag.to, RANGE)
      : null;

  const weekLabel = ts.weekOf(dayLabel(days[0], "dayMonth"), dayLabel(days[6], "dayMonthYear"));
  const span = RANGE.end - RANGE.start;
  const pct = (m: number) => `${((m - RANGE.start) / span) * 100}%`;

  // Jours de la semaine affichée qui ont au moins un bloc (point sous l'onglet, au téléphone).
  const busyDays = new Set(days.filter((day) => blocksOnDay(blocks, day).length > 0));

  const hiddenThisWeek = days.flatMap((day) =>
    layoutDay(blocksOnDay(blocks, day), RANGE).hidden.map((b) => ({ day, b })),
  );

  // Blocs qui reviennent : hebdomadaires (par jour) puis autres répétitions (par début).
  const weekly = blocks
    .filter((b) => isRecurring(b) && b.source !== "subscription")
    .sort(
      (a, b) =>
        (a.weekday ?? 8) - (b.weekday ?? 8) ||
        (a.validFrom ?? "").localeCompare(b.validFrom ?? "") ||
        a.startMinute - b.startMinute ||
        a.title.localeCompare(b.title),
    );
  const outlookCount = blocks.filter(
    (b) => b.source === "outlook" && (b.validFrom ?? "") >= today,
  ).length;
  // Calendriers abonnés : gérés dans Profil, comptés ici (à venir ou en cours).
  const subscriptionCount = blocks.filter(
    (b) => b.source === "subscription" && (b.validUntil ?? b.validFrom ?? "") >= today,
  ).length;
  const once = blocks
    // Revue récurrence 3 : un bloc « tous les X jours / mois / ans » n'a pas de jour de semaine,
    // mais il revient : il est déjà dans la liste du dessus.
    .filter(
      (b) =>
        !isRecurring(b) &&
        b.source !== "outlook" &&
        b.source !== "subscription" &&
        (b.validFrom ?? "") >= today,
    )
    .sort(
      (a, b) =>
        (a.validFrom ?? "").localeCompare(b.validFrom ?? "") || a.startMinute - b.startMinute,
    );

  return (
    <div className="flex flex-col gap-4">
      <FlashMessage message={flash} onClose={clearMessage} />

      {study && studyPlan.loading && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <BookOpen className="text-study size-4" aria-hidden />
          {studyPlan.loading === "planifier" ? ts.computingStudy : ts.searchingSlots}
        </p>
      )}
      {study && !studyPlan.plan && !studyPlan.loading && (
        <ConflictNotice
          conflicts={study.conflicts}
          onReplan={() => void studyPlan.run("replanifier")}
          pending={studyPlan.busy}
        />
      )}
      {studyPlan.plan && (
        <StudyPanel
          plan={studyPlan.plan}
          busy={studyPlan.busy || moving !== null}
          errorKey={studyPlan.errorKey}
          onAccept={(keys) => void studyPlan.accept(keys)}
          onRefuse={studyPlan.refuse}
          onNudge={studyPlan.nudge}
          onShow={showSession}
        />
      )}

      {/* Navigation entre les semaines */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={ts.prevWeek}
          onClick={() => setMonday(shiftDay(monday, -7))}
        >
          <ChevronLeft />
        </Button>
        <p className="flex-1 text-center text-sm font-medium" aria-live="polite">
          {weekLabel}
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label={ts.nextWeek}
          onClick={() => setMonday(shiftDay(monday, 7))}
        >
          <ChevronRight />
        </Button>
      </div>
      {/* Téléphone : deux boutons d'égale largeur (2 colonnes chacun de la grille à 4). */}
      <div className="grille-4-demi sm:flex sm:flex-wrap sm:justify-end sm:gap-2">
        {monday !== weekStart(today) && (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-full sm:mr-auto"
            onClick={() => {
              setMonday(weekStart(today));
              setSelectedDay(today);
            }}
          >
            {ts.backToThisWeek}
          </Button>
        )}
        <IcsImport
          places={places}
          homeId={homeId}
          defaultPlaceId={defaultPlace}
          actions={icsActions}
          onOpen={() => setMessage(null)}
          onImported={(text) => setMessage(text)}
        />
        <Button
          size="sm"
          onClick={() => {
            setMessage(null);
            setDraft(newDraft(activeDay, 9 * 60, 10 * 60));
          }}
        >
          <Plus /> {ts.addBlock}
        </Button>
      </div>

      {/* Onglets des jours (téléphone seulement : un jour à la fois) */}
      <div role="tablist" aria-label={ts.dayShown} className="grid grid-cols-7 gap-1 md:hidden">
        {days.map((day) => (
          <button
            key={day}
            role="tab"
            type="button"
            aria-selected={day === activeDay}
            onClick={() => setSelectedDay(day)}
            style={dayColorStyle(weekdayOf(day))}
            className={cn(
              // Trait de la couleur du jour en haut de l'onglet.
              "flex flex-col items-center rounded-md border border-t-[3px] border-t-(--jour) py-1.5 text-xs",
              day === activeDay && "border-primary bg-primary text-primary-foreground",
              day === today && day !== activeDay && "border-primary",
            )}
          >
            <span>{weekdayShort(weekdayOf(day), locale).replace(".", "")}</span>
            <span className="text-sm font-semibold">{dayLabel(day, "dayNumber")}</span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 size-1.5 rounded-full",
                busyDays.has(day) ? "bg-current" : "bg-transparent",
              )}
            />
            {busyDays.has(day) && <span className="sr-only">{ts.busy}</span>}
          </button>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        <span className="hidden md:inline">{ts.hintClick}</span>
        <span className="md:hidden">{ts.hintTouch}</span>
        {ts.hintRest}
      </p>

      <WeekLegend
        legend={scheduleLegend(
          days.flatMap((day) => blocksOnDay(blocks, day)),
          {
            quiet: quiet?.before != null || quiet?.after != null,
            proposedStudy: proposals.some((p) => days.includes(p.day)),
          },
        )}
        colorOf={colorOf}
        placeLabel={placeLabel}
      />

      {/* Grille */}
      <div
        id="grille-horaire"
        className="flex scroll-mt-16 select-none"
        role="region"
        aria-label={ts.weekGrid}
      >
        <div className="w-11 shrink-0 pt-8 md:pt-10" aria-hidden>
          <div className="relative h-[56rem]">
            {HOURS.map((m) => (
              <span
                key={m}
                className="text-muted-foreground absolute right-1.5 -translate-y-1/2 text-xs"
                style={{ top: pct(m) }}
              >
                {clock(m)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-1 md:grid-cols-7">
          {days.map((day) => {
            const items: GridItem[] = [
              ...blocksOnDay(blocks, day).map((b) => ({
                id: b.id,
                startMinute: b.startMinute,
                endMinute: b.endMinute,
                block: b,
              })),
              ...proposals
                .filter((s) => s.day === day)
                .map((s) => ({
                  id: `proposition:${s.key}`,
                  startMinute: s.startMinute,
                  endMinute: s.endMinute,
                  proposal: s,
                })),
            ];
            const { placed } = layoutDay(items, RANGE);
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn("min-w-0 md:border-l", day !== activeDay && "hidden md:block")}
                style={dayColorStyle(weekdayOf(day))}
              >
                <div
                  className={cn(
                    // Trait de la couleur du jour au-dessus de son nom.
                    "flex h-8 items-center justify-center gap-1 border-t-[3px] border-t-(--jour) text-xs md:h-10 md:flex-col md:gap-0",
                    "bg-[color-mix(in_oklab,var(--jour)_14%,transparent)]",
                    isToday && "text-primary font-semibold",
                  )}
                >
                  <span className="md:hidden">{dayLabel(day, "weekdayDayMonth")}</span>
                  <span className="hidden md:inline">{weekdayShort(weekdayOf(day), locale)}</span>
                  <span className="hidden text-sm md:inline">{dayLabel(day, "dayNumber")}</span>
                </div>
                <div
                  data-day={day}
                  aria-label={`${weekdayLong(weekdayOf(day), locale)} ${dayLabel(day, "dayMonth")}`}
                  className={cn(
                    "relative h-[56rem] cursor-crosshair border-t",
                    // Fond très pâle de la couleur du jour ; aujourd'hui un peu plus marqué.
                    isToday
                      ? "bg-[color-mix(in_oklab,var(--jour)_13%,transparent)]"
                      : "bg-[color-mix(in_oklab,var(--jour)_7%,transparent)] dark:bg-[color-mix(in_oklab,var(--jour)_9%,transparent)]",
                  )}
                  style={{
                    // Une ligne par heure, une ligne pâle par demi-heure.
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 1.75rem, color-mix(in oklab, var(--border) 45%, transparent) 1.75rem calc(1.75rem + 1px), transparent calc(1.75rem + 1px) 3.5rem)",
                  }}
                  onPointerDown={(e) => onPointerDown(e, day)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onClick={onClick}
                  onPointerCancel={() => setDrag(null)}
                >
                  {quiet?.before != null && quiet.before > RANGE.start && (
                    <QuietZone top={0} bottom={pct(Math.min(quiet.before, RANGE.end))} />
                  )}
                  {quiet?.after != null && quiet.after < RANGE.end && (
                    <QuietZone top={pct(Math.max(quiet.after, RANGE.start))} bottom="100%" />
                  )}
                  {placed.map((p) => {
                    const style = {
                      top: `calc(${p.top * 100}% + 1px)`,
                      height: `calc(${p.height * 100}% - 2px)`,
                      left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / p.lanes}% - 4px)`,
                    };
                    const s = p.item.proposal;
                    if (s) {
                      const isMoving = moving?.key === s.key;
                      return (
                        <button
                          key={p.item.id}
                          type="button"
                          aria-label={ts.proposedSession(s.title, s.label, s.placeName)}
                          onPointerDown={(e) => onProposalPointerDown(e, s)}
                          onPointerMove={onProposalPointerMove}
                          onPointerUp={onProposalPointerUp}
                          onPointerCancel={() => setMoving(null)}
                          className={cn(
                            "absolute cursor-grab touch-none overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight focus-visible:ring-2 focus-visible:outline-none",
                            PROPOSED_STUDY_COLOR,
                            isMoving && "z-10 cursor-grabbing opacity-80 shadow-lg",
                            studyPlan.errorKey === s.key && "border-destructive",
                          )}
                          style={style}
                          title={ts.proposedTitle(s.title, s.label, s.placeName)}
                        >
                          <span className="text-study block truncate text-[10px] font-semibold tracking-wide uppercase">
                            {ts.proposed}
                          </span>
                          <span className="block truncate font-semibold">{s.title}</span>
                          <span className="block truncate">
                            {clock(s.startMinute)}–{clock(s.endMinute)}
                          </span>
                          <span className="block truncate opacity-80">{s.placeName}</span>
                        </button>
                      );
                    }
                    const b = p.item.block as ScheduleBlock;
                    return (
                      <button
                        key={p.item.id}
                        type="button"
                        onClick={() => {
                          setMessage(null);
                          // Plan de groupe : on le gère (refuser) dans « Mes plans ».
                          if (b.source === "meetup") router.push("/plans");
                          // Outlook : lecture seule, géré dans Profil.
                          else if (b.source === "outlook") router.push("/profil#outlook");
                          // Calendrier abonné : lecture seule, géré dans Profil.
                          else if (b.source === "subscription") router.push("/profil#abonnements");
                          // Séance d'étude : on la gère (retirer, déplaçable) dans « Étude ».
                          else if (b.source === "study") router.push("/etude");
                          else setDraft(editDraft(b, day));
                        }}
                        className={cn(
                          "absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none",
                          sourceColor(b, colorOf(b.placeId)),
                          conflictIds.has(b.id) && "ring-destructive ring-2",
                          p.cutTop && "rounded-t-none",
                          p.cutBottom && "rounded-b-none",
                        )}
                        style={style}
                        title={ts.blockTitle(
                          b.title,
                          clock(b.startMinute),
                          clock(b.endMinute),
                          b.subscription
                            ? `${b.subscription.name}${b.subscription.countsAsBusy ? "" : ts.notBlocking}`
                            : placeLabel(b.placeId),
                          conflictIds.has(b.id),
                        )}
                      >
                        <span className="block truncate font-semibold">{b.title}</span>
                        <span className="block truncate">
                          {clock(b.startMinute)}–{clock(b.endMinute)}
                        </span>
                        <span className="block truncate opacity-80">
                          {b.subscription ? b.subscription.name : placeLabel(b.placeId)}
                        </span>
                      </button>
                    );
                  })}
                  {preview && drag?.day === day && (
                    <div
                      className="border-primary bg-primary/20 pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed text-[11px]"
                      style={{
                        top: pct(preview.startMinute),
                        height: `${((preview.endMinute - preview.startMinute) / span) * 100}%`,
                      }}
                    >
                      <span className="px-1">
                        {clock(preview.startMinute)}–{clock(preview.endMinute)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hiddenThisWeek.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {ts.outsideGrid}
          {hiddenThisWeek
            .map(
              ({ day, b }) =>
                `${weekdayShort(weekdayOf(day), locale)} ${clock(b.startMinute)}–${clock(b.endMinute)} ${b.title}`,
            )
            .join(" ; ")}
          .
        </p>
      )}

      {/* Liste : utile au clavier et pour voir les sessions d'un coup d'œil */}
      <section aria-labelledby="liste-blocs" className="flex flex-col gap-3">
        <h2 id="liste-blocs" className="text-lg font-semibold">
          {ts.recurringTitle}
        </h2>
        {weekly.length === 0 ? (
          <p className="text-muted-foreground text-sm">{ts.noRecurring}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {weekly.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                when={ts.whenAt(recurringWhen(b, locale), clock(b.startMinute), clock(b.endMinute))}
                period={
                  b.validFrom && b.validUntil
                    ? ts.periodFromTo(
                        dayLabel(b.validFrom, "shortDayMonthYear"),
                        dayLabel(b.validUntil, "shortDayMonthYear"),
                      )
                    : b.validFrom
                      ? ts.periodFrom(dayLabel(b.validFrom, "shortDayMonthYear"))
                      : ts.noEnd
                }
                place={placeLabel(b.placeId)}
                color={colorOf(b.placeId)}
                onEdit={() => {
                  setMessage(null);
                  const day =
                    b.weekday == null
                      ? (b.validFrom ?? today)
                      : (days.find((d) => weekdayOf(d) === b.weekday) ?? days[0]);
                  setDraft(editDraft(b, day));
                }}
              />
            ))}
          </ul>
        )}
        <h2 className="text-lg font-semibold">{ts.onceTitle}</h2>
        {outlookCount > 0 && (
          <p className="text-muted-foreground text-sm">
            {ts.outlookMore(outlookCount)}
            <Link href="/profil#outlook" className="underline underline-offset-2">
              {ts.manageOutlook}
            </Link>
          </p>
        )}
        {subscriptionCount > 0 && (
          <p className="text-muted-foreground text-sm">
            {ts.subscriptionsMore(subscriptionCount)}
            <Link href="/profil#abonnements" className="underline underline-offset-2">
              {ts.manageCalendars}
            </Link>
          </p>
        )}
        {once.length === 0 ? (
          <p className="text-muted-foreground text-sm">{ts.noOnce}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {once.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                when={ts.whenAt(
                  dayLabel(b.validFrom ?? today, "weekdayDayMonthYear"),
                  clock(b.startMinute),
                  clock(b.endMinute),
                )}
                place={placeLabel(b.placeId)}
                color={colorOf(b.placeId)}
                onEdit={() => {
                  setMessage(null);
                  setDraft(editDraft(b, b.validFrom ?? today));
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <BlockDialog
        draft={draft}
        blocks={blocks}
        places={places}
        homeId={homeId}
        actions={actions}
        onClose={() => setDraft(null)}
        onSaved={(text) => {
          setDraft(null);
          setMessage(text);
        }}
      />
    </div>
  );
}

/** Pastille et texte d'une entrée de la légende. */
const LEGEND_SWATCHES: Record<LegendKind, string> = {
  plan: MEETUP_COLOR,
  etude: ACCEPTED_STUDY_COLOR,
  outlook: OUTLOOK_COLOR,
  abonnement: SUBSCRIPTION_BUSY_COLOR,
  "abonnement-libre": SUBSCRIPTION_INFO_COLOR,
};

/** Ce que veulent dire les couleurs de la grille (seulement ce qui est dans la semaine). */
function WeekLegend({
  legend,
  colorOf,
  placeLabel,
}: {
  legend: ScheduleLegend;
  colorOf: (placeId: string | null) => string;
  placeLabel: (placeId: string | null) => string;
}) {
  const { t } = useI18n();
  const tl = t.schedule.legend;
  if (legendIsEmpty(legend)) return null;
  const items: { key: string; swatch: string; label: string }[] = [
    ...legend.places.map((id) => ({
      key: `lieu-${id ?? "maison"}`,
      swatch: colorOf(id),
      label: placeLabel(id),
    })),
    ...legend.kinds.map((k) => ({ key: k, swatch: LEGEND_SWATCHES[k], label: tl[k] })),
    ...(legend.proposedStudy
      ? [
          {
            key: "proposee",
            swatch: PROPOSED_STUDY_COLOR,
            label: tl.proposed,
          },
        ]
      : []),
  ];
  return (
    <ul
      aria-label={tl.label}
      className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-xs"
    >
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("h-3.5 w-4 shrink-0 rounded-[3px] border border-l-[3px]", i.swatch)}
          />
          {i.label}
        </li>
      ))}
      {legend.quiet && (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3.5 w-4 shrink-0 rounded-[3px] border bg-[repeating-linear-gradient(135deg,transparent_0_2px,color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_2px_3px)]"
          />
          {tl.quiet}
        </li>
      )}
    </ul>
  );
}

function QuietZone({ top, bottom }: { top: number | string; bottom: string }) {
  const { t } = useI18n();
  return (
    <div
      aria-hidden
      title={t.schedule.quietTitle}
      className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--muted-foreground)_18%,transparent)_6px_8px)]"
      style={{ top, height: `calc(${bottom} - ${typeof top === "number" ? `${top}%` : top})` }}
    />
  );
}

/** Valeurs de départ des champs « Personnalisée » d'un brouillon. */
const CUSTOM_DEFAULTS = {
  repeatEvery: "2",
  repeatUnit: "week",
  repeatEnd: "never",
  repeatCount: "10",
} as const;

/**
 * Quand revient un bloc, pour la liste : « lundi », « mardi, toutes les 2 semaines »,
 * « Chaque mois, le 31 (ou le dernier jour du mois) ».
 */
function recurringWhen(b: ScheduleBlock, locale: Locale): string {
  const label = repeatLabel(b, locale) ?? "";
  if (b.weekday == null) return label.charAt(0).toUpperCase() + label.slice(1);
  const day = weekdayLong(b.weekday as Weekday, locale);
  return (b.repeatEvery ?? 1) > 1 ? `${day}, ${label}` : day;
}

function BlockRow({
  block,
  when,
  period,
  place,
  color,
  onEdit,
}: {
  block: ScheduleBlock;
  when: string;
  period?: string;
  place: string;
  color: string;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const ts = t.schedule;
  return (
    <li className="bg-card flex items-start gap-3 rounded-lg border p-3">
      <span
        className={cn("mt-1 size-3 shrink-0 rounded-full border-2", sourceColor(block, color))}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="font-medium break-words">
          {block.title}{" "}
          {block.source === "meetup" ? (
            <Badge variant="secondary" className="ml-1">
              <Users /> {ts.badgePlan}
            </Badge>
          ) : block.source === "study" ? (
            <Badge variant="secondary" className="ml-1">
              <BookOpen /> {ts.badgeStudy}
            </Badge>
          ) : (
            block.source !== "manual" && (
              <Badge variant="secondary" className="ml-1">
                {ts.badgeImported}
              </Badge>
            )
          )}
        </span>
        <span>{when}</span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <MapPin className="size-3" />{" "}
          {block.source === "meetup" && !block.placeId ? ts.placeInPlan : place}
          {period && <> · {period}</>}
        </span>
      </div>
      {block.source === "meetup" ? (
        <Button asChild size="sm" variant="outline">
          <Link href="/plans" aria-label={ts.seePlanLabel(block.title)}>
            {ts.seePlan}
          </Link>
        </Button>
      ) : block.source === "study" ? (
        <Button asChild size="sm" variant="outline">
          <Link href="/etude" aria-label={ts.manageSessionLabel(block.title)}>
            {ts.manage}
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onEdit} aria-label={ts.editLabel(block.title)}>
          <Pencil /> {t.common.edit}
        </Button>
      )}
    </li>
  );
}
