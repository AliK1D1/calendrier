"use client";

import { Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PLAN_DURATIONS,
  PLAN_LOCATION_MAX,
  PLAN_TITLE_MAX,
  type PlanRepeat,
  type ProposeFormInput,
} from "@/lib/plans/validation";
import { REPEAT_EVERY_MAX, type RepeatUnit } from "@/lib/scheduling/recurrence";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { formatDuration } from "@/lib/i18n/format";

/** Valeurs de départ du formulaire (`inviteeIds` nul = tout le groupe). */
export type ProposeDraft = Omit<ProposeFormInput, "groupId"> & {
  /** Rappel du créneau d'origine (« mardi 16 mars, 18 h – 20 h »), s'il y en a un. */
  fromSlot?: string;
};

export type ProposeAction = (
  raw: unknown,
) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;

interface Props {
  draft: ProposeDraft | null;
  groupId: string;
  myId: string;
  members: { userId: string; displayName: string }[];
  places: { id: string; name: string }[];
  propose: ProposeAction;
  onClose: () => void;
  onDone: (message: string) => void;
}

const SELECT =
  "border-input bg-card focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]";

/** Choix rapides de « Répéter » (story 5) ; « custom » ouvre « tous les X … ». */
type RepeatChoice = "none" | "day1" | "day2" | "week1" | "custom";

const REPEAT_CHOICES: RepeatChoice[] = ["none", "day1", "day2", "week1", "custom"];

const CUSTOM_UNITS: RepeatUnit[] = ["day", "week", "month"];

function choiceOf(r: PlanRepeat | null | undefined): RepeatChoice {
  if (!r) return "none";
  if (r.unit === "day" && r.every === 1) return "day1";
  if (r.unit === "day" && r.every === 2) return "day2";
  if (r.unit === "week" && r.every === 1) return "week1";
  return "custom";
}

/** Fenêtre « Proposer un moment » (élément <dialog> natif, en bas de l'écran sur téléphone). */
export function ProposeDialog({ draft, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (draft && !d.open) d.showModal();
    if (!draft && d.open) d.close();
  }, [draft]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="proposer-titre"
      onClose={rest.onClose}
      className="bg-popover text-popover-foreground shadow-flottant m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {draft && (
        <ProposeForm
          key={`${draft.date}-${draft.start}-${draft.placeId ?? ""}-${draft.durationMinutes}-${choiceOf(draft.repeat)}`}
          initial={draft}
          {...rest}
        />
      )}
    </dialog>
  );
}

function ProposeForm({
  initial,
  groupId,
  myId,
  members,
  places,
  propose,
  onClose,
  onDone,
}: Omit<Props, "draft"> & { initial: ProposeDraft }) {
  const id = useId();
  const { locale, t, tr } = useI18n();
  const tp = t.plans.propose;
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [duration, setDuration] = useState(initial.durationMinutes);
  const [placeId, setPlaceId] = useState<string>(initial.placeId ?? "");
  const [location, setLocation] = useState(initial.location);
  const [everyone, setEveryone] = useState(initial.inviteeIds === null);
  const others = members.filter((m) => m.userId !== myId);
  const [chosen, setChosen] = useState<string[]>(
    (initial.inviteeIds ?? others.map((m) => m.userId)).filter((x) => x !== myId),
  );
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(choiceOf(initial.repeat));
  const [customEvery, setCustomEvery] = useState(initial.repeat?.every ?? 3);
  const [customUnit, setCustomUnit] = useState<RepeatUnit>(initial.repeat?.unit ?? "day");
  const [until, setUntil] = useState(initial.repeat?.until ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function repeatValue(): PlanRepeat | null {
    const end = until || null;
    switch (repeatChoice) {
      case "none":
        return null;
      case "day1":
        return { unit: "day", every: 1, until: end };
      case "day2":
        return { unit: "day", every: 2, until: end };
      case "week1":
        return { unit: "week", every: 1, until: end };
      case "custom":
        return { unit: customUnit, every: customEvery, until: end };
    }
  }
  const recurring = repeatChoice !== "none";
  const durations = PLAN_DURATIONS.includes(duration as (typeof PLAN_DURATIONS)[number])
    ? [...PLAN_DURATIONS]
    : [...PLAN_DURATIONS, duration].sort((a, b) => a - b);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!everyone && chosen.length === 0) {
      setError(tp.pickSomeone);
      return;
    }
    startTransition(async () => {
      const r = await propose({
        groupId,
        title,
        date,
        start,
        durationMinutes: duration,
        placeId: placeId || null,
        location: placeId ? "" : location,
        inviteeIds: everyone ? null : chosen,
        repeat: repeatValue(),
      } satisfies ProposeFormInput);
      if (r.ok) {
        onDone(everyone ? tp.sentAll(recurring) : tp.sentSome(recurring, chosen.length));
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="proposer-titre" className="titre-section">
            {recurring ? tp.titleRecurring : tp.title}
          </h2>
          {initial.fromSlot && (
            <p className="text-muted-foreground text-sm first-letter:uppercase">
              {tp.slotFound(initial.fromSlot)}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t.common.close}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-titre`}>{tp.what}</Label>
        <Input
          id={`${id}-titre`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={PLAN_TITLE_MAX}
          placeholder={recurring ? tp.whatPlaceholderRecurring : tp.whatPlaceholder}
          required
        />
      </div>

      <div className="grille-4-demi">
        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Label htmlFor={`${id}-jour`}>{tp.day}</Label>
          <Input
            id={`${id}-jour`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-debut`}>{tp.start}</Label>
          <Input
            id={`${id}-debut`}
            type="time"
            step={300}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-duree`}>{tp.duration}</Label>
          <select
            id={`${id}-duree`}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={SELECT}
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {formatDuration(d, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-repeter`}>{tp.repeat}</Label>
        <select
          id={`${id}-repeter`}
          value={repeatChoice}
          onChange={(e) => setRepeatChoice(e.target.value as RepeatChoice)}
          className={SELECT}
        >
          {REPEAT_CHOICES.map((c) => (
            <option key={c} value={c}>
              {tp.repeatChoices[c]}
            </option>
          ))}
        </select>
        {repeatChoice === "custom" && (
          <div className="flex items-center gap-2 text-sm">
            <span>{tp.every}</span>
            <Input
              aria-label={tp.number}
              type="number"
              inputMode="numeric"
              min={1}
              max={REPEAT_EVERY_MAX}
              value={customEvery}
              onChange={(e) => setCustomEvery(Number(e.target.value))}
              className="h-11 w-20"
              required
            />
            <select
              aria-label={tp.unit}
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as RepeatUnit)}
              className={cn(SELECT, "w-auto flex-1")}
            >
              {CUSTOM_UNITS.map((u) => (
                <option key={u} value={u}>
                  {tp.customUnits[u]}
                </option>
              ))}
            </select>
          </div>
        )}
        {recurring && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-fin`}>{tp.until}</Label>
            <Input
              id={`${id}-fin`}
              type="date"
              min={date}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">{tp.untilHint}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-lieu`}>{tp.where}</Label>
        <select
          id={`${id}-lieu`}
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          className={SELECT}
        >
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="">{tp.otherPlace}</option>
        </select>
        {!placeId && (
          <Input
            aria-label={tp.freePlace}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={PLAN_LOCATION_MAX}
            placeholder={tp.freePlacePlaceholder}
          />
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{tp.who}</legend>
        <div className="grille-4-demi">
          {[
            [true, tp.wholeGroup],
            [false, tp.somePeople],
          ].map(([value, label]) => (
            <label
              key={String(value)}
              className="bg-card has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-center text-sm"
            >
              <input
                type="radio"
                name={`${id}-qui`}
                checked={everyone === value}
                onChange={() => setEveryone(value as boolean)}
                className="sr-only"
              />
              {label as string}
            </label>
          ))}
        </div>
        {!everyone && (
          <div className="flex flex-wrap gap-2">
            {others.map((m) => (
              <label
                key={m.userId}
                className="bg-card has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={chosen.includes(m.userId)}
                  onChange={() =>
                    setChosen((c) =>
                      c.includes(m.userId) ? c.filter((x) => x !== m.userId) : [...c, m.userId],
                    )
                  }
                />
                {m.displayName}
              </label>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">{tp.whoHint}</p>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="border-destructive/50 text-destructive rounded-md border p-3 text-sm"
        >
          {tr(error)}
        </p>
      )}

      <div
        className={cn(
          "bg-card sticky bottom-0 -mx-4 flex gap-2 border-t px-4 pt-3 sm:-mx-6 sm:px-6",
        )}
      >
        <Button type="submit" size="lg" className="flex-1" disabled={pending}>
          <Send /> {pending ? tp.sending : tp.send}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
