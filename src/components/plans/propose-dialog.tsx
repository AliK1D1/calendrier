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

const REPEAT_CHOICES: { value: RepeatChoice; label: string }[] = [
  { value: "none", label: "Une seule fois" },
  { value: "day1", label: "Tous les jours" },
  { value: "day2", label: "Tous les 2 jours" },
  { value: "week1", label: "Chaque semaine" },
  { value: "custom", label: "Personnalisé…" },
];

const CUSTOM_UNITS: { value: RepeatUnit; label: string }[] = [
  { value: "day", label: "jour(s)" },
  { value: "week", label: "semaine(s)" },
  { value: "month", label: "mois" },
];

function choiceOf(r: PlanRepeat | null | undefined): RepeatChoice {
  if (!r) return "none";
  if (r.unit === "day" && r.every === 1) return "day1";
  if (r.unit === "day" && r.every === 2) return "day2";
  if (r.unit === "week" && r.every === 1) return "week1";
  return "custom";
}

function durationLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
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
      className="bg-card text-card-foreground m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 shadow-xl backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
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
      setError("Choisis au moins une personne à inviter.");
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
        const what = recurring ? "Série" : "Proposition";
        const where = recurring ? "Elle se répète dans ton horaire." : "Elle est dans ton horaire.";
        onDone(
          everyone
            ? `${what} envoyée à tout le groupe. ${where}`
            : `${what} envoyée (${chosen.length} invité${chosen.length > 1 ? "s" : ""}). ${where}`,
        );
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="proposer-titre" className="text-lg font-semibold">
            {recurring ? "Proposer une activité régulière" : "Proposer un moment"}
          </h2>
          {initial.fromSlot && (
            <p className="text-muted-foreground text-sm first-letter:uppercase">
              Créneau trouvé : {initial.fromSlot}
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-titre`}>Quoi ?</Label>
        <Input
          id={`${id}-titre`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={PLAN_TITLE_MAX}
          placeholder={
            recurring ? "ex. Gym, course, étude à la bibli" : "ex. Étude à la bibli, souper, cinéma"
          }
          required
        />
      </div>

      <div className="grille-4-demi">
        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Label htmlFor={`${id}-jour`}>Jour</Label>
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
          <Label htmlFor={`${id}-debut`}>Début</Label>
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
          <Label htmlFor={`${id}-duree`}>Durée</Label>
          <select
            id={`${id}-duree`}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={SELECT}
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-repeter`}>Répéter</Label>
        <select
          id={`${id}-repeter`}
          value={repeatChoice}
          onChange={(e) => setRepeatChoice(e.target.value as RepeatChoice)}
          className={SELECT}
        >
          {REPEAT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {repeatChoice === "custom" && (
          <div className="flex items-center gap-2 text-sm">
            <span>Tous les</span>
            <Input
              aria-label="Nombre"
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
              aria-label="Unité"
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as RepeatUnit)}
              className={cn(SELECT, "w-auto flex-1")}
            >
              {CUSTOM_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {recurring && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-fin`}>Jusqu&apos;au (facultatif)</Label>
            <Input
              id={`${id}-fin`}
              type="date"
              min={date}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">
              Laisse vide pour une série sans fin. Le jour choisi plus haut est la première fois.
              Chaque invité accepte une seule fois pour toute la série, et chacun peut la quitter ou
              l&apos;arrêter quand il veut.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-lieu`}>Où ?</Label>
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
          <option value="">Autre lieu (écrire) ou à préciser</option>
        </select>
        {!placeId && (
          <Input
            aria-label="Lieu (texte libre)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={PLAN_LOCATION_MAX}
            placeholder="ex. Chez Sam, appel vidéo (facultatif)"
          />
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Qui est invité ?</legend>
        <div className="grille-4-demi">
          {[
            [true, "Tout le groupe"],
            [false, "Certaines personnes"],
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
        <p className="text-muted-foreground text-xs">
          Tout le groupe voit la proposition. Les invités acceptent ou refusent ; s&apos;ils
          acceptent, le moment s&apos;ajoute à leur horaire (même s&apos;il chevauche autre chose).
          Toi, tu es inscrit·e d&apos;office.
        </p>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="border-destructive/50 text-destructive rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}

      <div
        className={cn(
          "bg-card sticky bottom-0 -mx-4 flex gap-2 border-t px-4 pt-3 sm:-mx-6 sm:px-6",
        )}
      >
        <Button type="submit" size="lg" className="flex-1" disabled={pending}>
          <Send /> {pending ? "Envoi…" : "Proposer"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onClose}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
