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
  type ProposeFormInput,
} from "@/lib/plans/validation";
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
          key={`${draft.date}-${draft.start}-${draft.placeId ?? ""}-${draft.durationMinutes}`}
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
      } satisfies ProposeFormInput);
      if (r.ok) {
        onDone(
          everyone
            ? "Proposition envoyée à tout le groupe. Elle est dans ton horaire."
            : `Proposition envoyée (${chosen.length} invité${chosen.length > 1 ? "s" : ""}). Elle est dans ton horaire.`,
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
            Proposer un moment
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
          placeholder="ex. Étude à la bibli, souper, cinéma"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-2">
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
