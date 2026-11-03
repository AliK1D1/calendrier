"use client";

import { format, parseISO } from "date-fns";
import { frCA } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MapPin, Pencil, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { type Flash, FlashMessage } from "@/components/flash-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_GRID_RANGE, layoutDay, selectionFromDrag } from "@/lib/scheduling/weekGrid";
import {
  blocksOnDay,
  formatClock,
  formatClockFr,
  shiftDay,
  suggestSession,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  type Weekday,
  weekDays,
  weekdayOf,
  weekStart,
} from "@/lib/scheduling/weeklyBlocks";
import { cn } from "@/lib/utils";

import { BlockDialog, type BlockDraft } from "./block-dialog";
import { IcsImport } from "./ics-import";
import type { ScheduleBlock, ScheduleEditorProps } from "./types";

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

const dayLabel = (day: string, pattern: string) => format(parseISO(day), pattern, { locale: frCA });

/** Position d'un pointeur dans une colonne : fraction de la hauteur (0 = 7 h, 1 = 23 h). */
function fractionIn(el: HTMLElement, clientY: number): number {
  const r = el.getBoundingClientRect();
  return (clientY - r.top) / r.height;
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
}: ScheduleEditorProps) {
  const [monday, setMonday] = useState(() => weekStart(today));
  const days = useMemo(() => weekDays(monday), [monday]);
  const [selectedDay, setSelectedDay] = useState(today);
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0];
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const flash = useMemo<Flash>(() => (message ? { type: "ok", text: message } : null), [message]);
  const clearMessage = useCallback(() => setMessage(null), []);

  const placeName = useMemo(() => new Map(places.map((p) => [p.id, p.name])), [places]);
  const colorOf = useMemo(() => {
    const ids = [homeId ?? "", ...places.map((p) => p.id).filter((id) => id !== homeId)];
    return (placeId: string | null) =>
      COLORS[Math.max(0, ids.indexOf(placeId ?? homeId ?? "")) % COLORS.length];
  }, [places, homeId]);
  const placeLabel = (placeId: string | null) => (placeId && placeName.get(placeId)) || "Maison";

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
    };
  }

  function editDraft(b: ScheduleBlock, day: string): BlockDraft {
    return {
      id: b.id,
      title: b.title,
      placeId: b.placeId,
      start: formatClock(b.startMinute),
      end: formatClock(b.endMinute),
      kind: b.weekday == null ? "once" : "weekly",
      weekdays: b.weekday == null ? [weekdayOf(day)] : [b.weekday],
      date: b.weekday == null ? (b.validFrom ?? day) : day,
      sessionStart: b.validFrom ?? session.from,
      sessionEnd: b.validUntil ?? session.to,
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

  const preview =
    drag && drag.pointerType === "mouse" && drag.moved
      ? selectionFromDrag(drag.from, drag.to, RANGE)
      : null;

  const weekLabel = `${dayLabel(days[0], "d MMMM")} au ${dayLabel(days[6], "d MMMM yyyy")}`;
  const span = RANGE.end - RANGE.start;
  const pct = (m: number) => `${((m - RANGE.start) / span) * 100}%`;

  // Jours de la semaine affichée qui ont au moins un bloc (point sous l'onglet, au téléphone).
  const busyDays = new Set(days.filter((day) => blocksOnDay(blocks, day).length > 0));

  const hiddenThisWeek = days.flatMap((day) =>
    layoutDay(blocksOnDay(blocks, day), RANGE).hidden.map((b) => ({ day, b })),
  );

  const weekly = blocks
    .filter((b) => b.weekday != null)
    .sort(
      (a, b) =>
        (a.weekday ?? 0) - (b.weekday ?? 0) ||
        a.startMinute - b.startMinute ||
        a.title.localeCompare(b.title),
    );
  const once = blocks
    .filter((b) => b.weekday == null && (b.validFrom ?? "") >= today)
    .sort(
      (a, b) =>
        (a.validFrom ?? "").localeCompare(b.validFrom ?? "") || a.startMinute - b.startMinute,
    );

  return (
    <div className="flex flex-col gap-4">
      <FlashMessage message={flash} onClose={clearMessage} />

      {/* Navigation entre les semaines */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Semaine précédente"
          onClick={() => setMonday(shiftDay(monday, -7))}
        >
          <ChevronLeft />
        </Button>
        <p className="flex-1 text-center text-sm font-medium" aria-live="polite">
          Semaine du {weekLabel}
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label="Semaine suivante"
          onClick={() => setMonday(shiftDay(monday, 7))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {monday !== weekStart(today) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonday(weekStart(today));
              setSelectedDay(today);
            }}
          >
            Revenir à cette semaine
          </Button>
        )}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
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
            <Plus /> Ajouter un bloc
          </Button>
        </div>
      </div>

      {/* Onglets des jours (téléphone seulement : un jour à la fois) */}
      <div role="tablist" aria-label="Jour affiché" className="grid grid-cols-7 gap-1 md:hidden">
        {days.map((day) => (
          <button
            key={day}
            role="tab"
            type="button"
            aria-selected={day === activeDay}
            onClick={() => setSelectedDay(day)}
            className={cn(
              "flex flex-col items-center rounded-md border py-1.5 text-xs",
              day === activeDay && "border-primary bg-primary text-primary-foreground",
              day === today && day !== activeDay && "border-primary",
            )}
          >
            <span>{WEEKDAY_SHORT[weekdayOf(day)].replace(".", "")}</span>
            <span className="text-sm font-semibold">{dayLabel(day, "d")}</span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 size-1.5 rounded-full",
                busyDays.has(day) ? "bg-current" : "bg-transparent",
              )}
            />
            {busyDays.has(day) && <span className="sr-only"> (occupé)</span>}
          </button>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        <span className="hidden md:inline">Clique-glisse</span>
        <span className="md:hidden">Touche</span> une case vide pour ajouter un bloc ; touche un
        bloc pour le modifier.
      </p>

      {/* Grille */}
      <div className="flex select-none" role="region" aria-label="Grille de la semaine">
        <div className="w-11 shrink-0 pt-8 md:pt-10" aria-hidden>
          <div className="relative h-[56rem]">
            {HOURS.map((m) => (
              <span
                key={m}
                className="text-muted-foreground absolute right-1.5 -translate-y-1/2 text-[11px]"
                style={{ top: pct(m) }}
              >
                {formatClockFr(m)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-1 md:grid-cols-7">
          {days.map((day) => {
            const { placed } = layoutDay(blocksOnDay(blocks, day), RANGE);
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn("min-w-0 md:border-l", day !== activeDay && "hidden md:block")}
              >
                <div
                  className={cn(
                    "flex h-8 items-center justify-center gap-1 text-xs md:h-10 md:flex-col md:gap-0",
                    isToday && "text-primary font-semibold",
                  )}
                >
                  <span className="md:hidden">{dayLabel(day, "EEEE d MMMM")}</span>
                  <span className="hidden md:inline">{WEEKDAY_SHORT[weekdayOf(day)]}</span>
                  <span className="hidden text-sm md:inline">{dayLabel(day, "d")}</span>
                </div>
                <div
                  data-day={day}
                  aria-label={`${WEEKDAY_LONG[weekdayOf(day)]} ${dayLabel(day, "d MMMM")}`}
                  className={cn(
                    "relative h-[56rem] cursor-crosshair border-t",
                    isToday && "bg-primary/5",
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
                  {placed.map((p) => (
                    <button
                      key={p.item.id}
                      type="button"
                      onClick={() => {
                        setMessage(null);
                        setDraft(editDraft(p.item, day));
                      }}
                      className={cn(
                        "absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none",
                        colorOf(p.item.placeId),
                        p.cutTop && "rounded-t-none",
                        p.cutBottom && "rounded-b-none",
                      )}
                      style={{
                        top: `calc(${p.top * 100}% + 1px)`,
                        height: `calc(${p.height * 100}% - 2px)`,
                        left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / p.lanes}% - 4px)`,
                      }}
                      title={`${p.item.title} · ${formatClockFr(p.item.startMinute)} à ${formatClockFr(p.item.endMinute)} · ${placeLabel(p.item.placeId)}`}
                    >
                      <span className="block truncate font-semibold">{p.item.title}</span>
                      <span className="block truncate">
                        {formatClockFr(p.item.startMinute)}–{formatClockFr(p.item.endMinute)}
                      </span>
                      <span className="block truncate opacity-80">
                        {placeLabel(p.item.placeId)}
                      </span>
                    </button>
                  ))}
                  {preview && drag?.day === day && (
                    <div
                      className="border-primary bg-primary/20 pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed text-[11px]"
                      style={{
                        top: pct(preview.startMinute),
                        height: `${((preview.endMinute - preview.startMinute) / span) * 100}%`,
                      }}
                    >
                      <span className="px-1">
                        {formatClockFr(preview.startMinute)}–{formatClockFr(preview.endMinute)}
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
          Hors de la grille (avant 7 h ou après 23 h) cette semaine :{" "}
          {hiddenThisWeek
            .map(
              ({ day, b }) =>
                `${WEEKDAY_SHORT[weekdayOf(day)]} ${formatClockFr(b.startMinute)}–${formatClockFr(b.endMinute)} ${b.title}`,
            )
            .join(" ; ")}
          .
        </p>
      )}

      {/* Liste : utile au clavier et pour voir les sessions d'un coup d'œil */}
      <section aria-labelledby="liste-blocs" className="flex flex-col gap-3">
        <h2 id="liste-blocs" className="text-lg font-semibold">
          Chaque semaine
        </h2>
        {weekly.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucun cours ni engagement hebdomadaire pour l&apos;instant.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {weekly.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                when={`${WEEKDAY_LONG[b.weekday as Weekday]}, ${formatClockFr(b.startMinute)} à ${formatClockFr(b.endMinute)}`}
                period={
                  b.validFrom && b.validUntil
                    ? `du ${dayLabel(b.validFrom, "d MMM yyyy")} au ${dayLabel(b.validUntil, "d MMM yyyy")}`
                    : "sans fin"
                }
                place={placeLabel(b.placeId)}
                color={colorOf(b.placeId)}
                onEdit={() => {
                  setMessage(null);
                  const day = days.find((d) => weekdayOf(d) === b.weekday) ?? days[0];
                  setDraft(editDraft(b, day));
                }}
              />
            ))}
          </ul>
        )}
        <h2 className="text-lg font-semibold">Une seule fois (à venir)</h2>
        {once.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun bloc ponctuel à venir.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {once.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                when={`${dayLabel(b.validFrom ?? today, "EEEE d MMMM yyyy")}, ${formatClockFr(b.startMinute)} à ${formatClockFr(b.endMinute)}`}
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

function QuietZone({ top, bottom }: { top: number | string; bottom: string }) {
  return (
    <div
      aria-hidden
      title="Je ne sors pas (réglé dans le profil)"
      className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--muted-foreground)_18%,transparent)_6px_8px)]"
      style={{ top, height: `calc(${bottom} - ${typeof top === "number" ? `${top}%` : top})` }}
    />
  );
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
  return (
    <li className="flex items-start gap-3 rounded-lg border p-3">
      <span className={cn("mt-1 size-3 shrink-0 rounded-full border-2", color)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="font-medium break-words">
          {block.title}{" "}
          {block.source !== "manual" && (
            <Badge variant="secondary" className="ml-1">
              importé
            </Badge>
          )}
        </span>
        <span>{when}</span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <MapPin className="size-3" /> {place}
          {period && <> · {period}</>}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onEdit}
        aria-label={`Modifier « ${block.title} »`}
      >
        <Pencil /> Modifier
      </Button>
    </li>
  );
}
