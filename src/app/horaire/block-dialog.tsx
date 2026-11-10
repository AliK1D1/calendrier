"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  REPEAT_COUNT_MAX,
  REPEAT_EVERY_MAX,
  repeatUnitLabels,
  REPEAT_UNITS,
} from "@/lib/scheduling/recurrence";
import { clockOptions } from "@/lib/scheduling/weekGrid";
import {
  BLOCK_TITLE_MAX,
  type BlockFormInput,
  type BlockSpec,
  findOverlaps,
  formatClock,
  repeatLabel,
  validateBlockForm,
  WEEKDAYS,
} from "@/lib/scheduling/weeklyBlocks";
import { cn } from "@/lib/utils";

import type { ScheduleActions, ScheduleBlock, SchedulePlace } from "./types";
import { useI18n } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { formatClockLocale, formatDay, weekdayLong, weekdayShort } from "@/lib/i18n/format";

/** Contenu du formulaire : un nouveau bloc (`id` absent) ou un bloc existant. */
export interface BlockDraft extends BlockFormInput {
  id?: string;
}

const SELECT =
  "border-input focus-visible:ring-ring/50 h-11 sm:h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

const START_OPTIONS = clockOptions().slice(0, -1);
const END_OPTIONS = clockOptions().slice(1);

interface Props {
  draft: BlockDraft | null;
  blocks: ScheduleBlock[];
  places: SchedulePlace[];
  homeId: string | null;
  actions: ScheduleActions;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Fenêtre « Nouveau bloc » / « Modifier le bloc » (élément <dialog> natif). */
export function BlockDialog({ draft, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (draft && !dialog.open) dialog.showModal();
    if (!draft && dialog.open) dialog.close();
  }, [draft]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="bloc-titre-fenetre"
      onClose={rest.onClose}
      className="bg-popover text-popover-foreground shadow-flottant m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {/* Clé : un nouveau brouillon remet le formulaire à zéro. */}
      {draft && <BlockForm key={formKey(draft)} initial={draft} {...rest} />}
    </dialog>
  );
}

function formKey(d: BlockDraft): string {
  return `${d.id ?? "nouveau"}-${d.date}-${d.start}-${d.end}-${d.weekdays.join("")}`;
}

function BlockForm({
  initial,
  blocks,
  places,
  homeId,
  actions,
  onClose,
  onSaved,
}: Omit<Props, "draft"> & { initial: BlockDraft }) {
  const { locale, t, tr } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const tb = t.schedule.block;
  const [d, setD] = useState<BlockDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = initial.id !== undefined;
  const set = <K extends keyof BlockDraft>(key: K, value: BlockDraft[K]) =>
    setD((prev) => ({ ...prev, [key]: value }));

  // Chevauchements avec mes autres blocs (avertissement seulement : c'est permis).
  const overlaps = useMemo(() => {
    // Titre provisoire : l'avertissement s'affiche avant même qu'on ait tapé le titre.
    const v = validateBlockForm({ ...d, title: d.title.trim() || "?" }, { single: editing });
    if (!v.ok) return [];
    const seen = new Map<string, ScheduleBlock>();
    for (const spec of v.value) {
      for (const b of findOverlaps({ ...spec, id: d.id }, blocks)) seen.set(b.id, b);
    }
    return [...seen.values()];
  }, [d, blocks, editing]);

  const homeName = places.find((p) => p.id === homeId)?.name;

  // Résumé d'une répétition personnalisée valide (« Toutes les 2 semaines, le mardi… »).
  const preview = useMemo(() => {
    if (d.kind !== "custom") return null;
    const v = validateBlockForm({ ...d, title: d.title.trim() || "?" }, { single: editing });
    return v.ok ? describeCustom(v.value, locale, tb) : null;
  }, [d, editing, locale, tb]);

  function chooseKind(kind: BlockDraft["kind"]) {
    setD((prev) => ({
      ...prev,
      kind,
      // Une répétition par jour / mois / an commence au jour choisi dans la grille.
      ...(kind === "custom" && !editing && prev.repeatUnit !== "week"
        ? { sessionStart: prev.date }
        : {}),
    }));
  }

  function submit() {
    setError(null);
    const v = validateBlockForm(d, { single: editing });
    if (!v.ok) {
      setError(tr(v.error));
      return;
    }
    startTransition(async () => {
      const r = editing ? await actions.modifierBloc(d.id, d) : await actions.ajouterBlocs(d);
      if (!r.ok) {
        setError(tr(r.error));
        return;
      }
      const n = v.value.length;
      onSaved(editing ? tb.edited(v.value[0].title) : tb.added(v.value[0].title, n));
    });
  }

  async function remove() {
    if (!d.id) return;
    const yes = await confirm({
      message: tb.confirmDelete(d.kind, d.title),
      action: t.common.delete,
    });
    if (!yes) return;
    setError(null);
    startTransition(async () => {
      const r = await actions.supprimerBloc(d.id);
      if (!r.ok) setError(tr(r.error));
      else onSaved(tb.deleted(d.title));
    });
  }

  return (
    <form
      method="dialog"
      // Nos propres messages (en français, pour tous les champs) plutôt que ceux du navigateur.
      noValidate
      className="flex flex-col gap-4 p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="bloc-titre-fenetre" className="titre-section">
          {editing ? tb.editTitle : tb.newTitle}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t.common.close}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-titre">{tb.title}</Label>
        <Input
          id="bloc-titre"
          value={d.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={BLOCK_TITLE_MAX}
          placeholder={tb.titlePlaceholder}
          autoComplete="off"
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-lieu">{tb.place}</Label>
        <select
          id="bloc-lieu"
          className={SELECT}
          value={d.placeId ?? ""}
          onChange={(e) => set("placeId", e.target.value || null)}
        >
          <option value="">{homeName ? tb.homeNamed(homeName) : tb.home}</option>
          {places
            .filter((p) => p.id !== homeId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>

      <div className="grille-4-demi">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloc-debut">{tb.start}</Label>
          <select
            id="bloc-debut"
            className={SELECT}
            value={d.start}
            onChange={(e) => set("start", e.target.value)}
          >
            {START_OPTIONS.map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockLocale(m, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloc-fin">{tb.end}</Label>
          <select
            id="bloc-fin"
            className={SELECT}
            value={d.end}
            onChange={(e) => set("end", e.target.value)}
          >
            {END_OPTIONS.map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockLocale(m, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{tb.repeat}</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["weekly", tb.kinds.weekly],
              ["once", tb.kinds.once],
              ["custom", tb.kinds.custom],
            ] as const
          ).map(([kind, label]) => (
            <label
              key={kind}
              className={cn(
                "rangee flex cursor-pointer items-center gap-2 p-3 text-sm has-[:focus-visible]:ring-2",
                d.kind === kind && "border-primary bg-accent font-medium",
              )}
            >
              <input
                type="radio"
                name="bloc-repetition"
                className="sr-only"
                checked={d.kind === kind}
                onChange={() => chooseKind(kind)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {d.kind === "custom" ? (
        <CustomRepeat d={d} set={set} editing={editing} preview={preview} />
      ) : d.kind === "weekly" ? (
        <>
          <WeekdayPicker
            weekdays={d.weekdays}
            editing={editing}
            legend={editing ? tb.day : tb.daysAll}
            onChange={(w) => set("weekdays", w)}
          />
          <div className="grille-4-demi">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bloc-session-debut">{tb.sessionStart}</Label>
              <Input
                id="bloc-session-debut"
                type="date"
                value={d.sessionStart}
                onChange={(e) => set("sessionStart", e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bloc-session-fin">{tb.sessionEnd}</Label>
              <Input
                id="bloc-session-fin"
                type="date"
                value={d.sessionEnd}
                min={d.sessionStart || undefined}
                onChange={(e) => set("sessionEnd", e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">{tb.sessionHint}</p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloc-date">{tb.day}</Label>
          <Input
            id="bloc-date"
            type="date"
            value={d.date}
            onChange={(e) => set("date", e.target.value)}
            required
          />
        </div>
      )}

      {overlaps.length > 0 && (
        <p
          role="status"
          className="border-warning/60 bg-warning/15 flex gap-2 rounded-md border p-3 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{tb.overlaps(overlaps.map((b) => tb.quoted(b.title)).join(", "))}</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t.common.cancel}
        </Button>
        {editing && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive ml-auto"
            disabled={pending}
            onClick={remove}
          >
            <Trash2 /> {t.common.delete}
          </Button>
        )}
      </div>
      {confirmDialog}
    </form>
  );
}

function WeekdayPicker({
  weekdays,
  editing,
  legend,
  onChange,
}: {
  weekdays: number[];
  editing: boolean;
  legend: string;
  onChange: (weekdays: number[]) => void;
}) {
  const { locale } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => {
          const checked = weekdays.includes(w);
          return (
            <label
              key={w}
              title={weekdayLong(w, locale)}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center rounded-md border text-xs has-[:focus-visible]:ring-2",
                checked && "border-primary bg-primary text-primary-foreground font-medium",
              )}
            >
              <input
                type={editing ? "radio" : "checkbox"}
                name="bloc-jours"
                className="sr-only"
                checked={checked}
                aria-label={weekdayLong(w, locale)}
                onChange={() =>
                  onChange(
                    editing
                      ? [w]
                      : checked
                        ? weekdays.filter((x) => x !== w)
                        : [...weekdays, w].sort(),
                  )
                }
              />
              {weekdayShort(w, locale).replace(".", "")}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Résumé d'une répétition personnalisée validée, pour l'aperçu sous le formulaire. */
function describeCustom(
  specs: BlockSpec[],
  locale: Locale,
  tb: Messages["schedule"]["block"],
): string {
  const first = specs[0];
  const label = repeatLabel(first, locale) ?? "";
  let text = label.charAt(0).toUpperCase() + label.slice(1);
  const weekdays = specs.flatMap((b) =>
    b.weekday == null ? [] : [weekdayLong(b.weekday, locale)],
  );
  if (weekdays.length) {
    const list =
      weekdays.length > 1
        ? `${weekdays.slice(0, -1).join(", ")} ${tb.and} ${weekdays[weekdays.length - 1]}`
        : weekdays[0];
    text += tb.on(list);
  }
  const day = (iso: string) => formatDay(iso, "dayMonthYear", locale);
  if (first.validFrom) text += tb.fromDay(day(first.validFrom));
  text += first.validUntil ? tb.untilDay(day(first.validUntil)) : tb.noEnd;
  return text;
}

const END_CHOICES = ["never", "date", "count"] as const;

/** Champs « Personnalisée » : tous les X jours / semaines / mois / ans, début, jours et fin. */
function CustomRepeat({
  d,
  set,
  editing,
  preview,
}: {
  d: BlockDraft;
  set: <K extends keyof BlockDraft>(key: K, value: BlockDraft[K]) => void;
  editing: boolean;
  preview: string | null;
}) {
  const { locale, t } = useI18n();
  const tb = t.schedule.block;
  const unitLabels = repeatUnitLabels(locale);
  const every = Number(d.repeatEvery);
  const plural = !Number.isInteger(every) || every !== 1;
  const unit = (REPEAT_UNITS as readonly string[]).includes(d.repeatUnit ?? "")
    ? (d.repeatUnit as (typeof REPEAT_UNITS)[number])
    : "week";
  const startDay = Number((d.sessionStart || "").slice(8, 10));

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-tous-les">{tb.every}</Label>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input
            id="bloc-tous-les"
            type="number"
            inputMode="numeric"
            min={1}
            max={REPEAT_EVERY_MAX}
            step={1}
            value={d.repeatEvery ?? ""}
            onChange={(e) => set("repeatEvery", e.target.value)}
            aria-describedby="bloc-tous-les-aide"
            required
          />
          <select
            aria-label={tb.unit}
            className={SELECT}
            value={unit}
            onChange={(e) => {
              const next = e.target.value;
              set("repeatUnit", next);
              // Passer des semaines à jour / mois / an : on part du jour choisi dans la grille.
              if (!editing && unit === "week" && next !== "week") set("sessionStart", d.date);
            }}
          >
            {REPEAT_UNITS.map((u) => (
              <option key={u} value={u}>
                {plural ? unitLabels[u].many : unitLabels[u].one}
              </option>
            ))}
          </select>
        </div>
        <p id="bloc-tous-les-aide" className="text-muted-foreground text-xs">
          {tb.everyHint(REPEAT_EVERY_MAX)}
        </p>
      </div>

      {unit === "week" && (
        <WeekdayPicker
          weekdays={d.weekdays}
          editing={editing}
          legend={editing ? tb.day : tb.days}
          onChange={(w) => set("weekdays", w)}
        />
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-repetition-debut">{tb.from}</Label>
        <Input
          id="bloc-repetition-debut"
          type="date"
          value={d.sessionStart}
          onChange={(e) => set("sessionStart", e.target.value)}
          required
        />
        {unit === "week" && <p className="text-muted-foreground text-xs">{tb.weekFirst}</p>}
        {(unit === "month" || unit === "year") && startDay > 28 && (
          <p className="text-muted-foreground text-xs">{tb.shortMonths(startDay)}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{tb.endLegend}</legend>
        {END_CHOICES.map((mode) => (
          <div key={mode} className="flex min-h-11 items-center gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="bloc-fin-repetition"
                className="size-4"
                checked={d.repeatEnd === mode}
                onChange={() => set("repeatEnd", mode)}
              />
              {tb.endChoices[mode]}
            </label>
            {mode === "date" && (
              <Input
                type="date"
                aria-label={tb.endDate}
                className="w-auto"
                value={d.sessionEnd}
                min={d.sessionStart || undefined}
                disabled={d.repeatEnd !== "date"}
                onChange={(e) => set("sessionEnd", e.target.value)}
              />
            )}
            {mode === "count" && (
              <>
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label={tb.times}
                  className="w-24"
                  min={1}
                  max={REPEAT_COUNT_MAX}
                  step={1}
                  value={d.repeatCount ?? ""}
                  disabled={d.repeatEnd !== "count"}
                  onChange={(e) => set("repeatCount", e.target.value)}
                />
                {tb.timesSuffix}
              </>
            )}
          </div>
        ))}
      </fieldset>

      {preview && (
        <p className="bg-muted rounded-md p-3 text-sm" aria-live="polite">
          {preview}
        </p>
      )}
    </>
  );
}
