"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clockOptions } from "@/lib/scheduling/weekGrid";
import {
  BLOCK_TITLE_MAX,
  type BlockFormInput,
  findOverlaps,
  formatClock,
  formatClockFr,
  validateBlockForm,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  WEEKDAYS,
} from "@/lib/scheduling/weeklyBlocks";
import { cn } from "@/lib/utils";

import type { ScheduleActions, ScheduleBlock, SchedulePlace } from "./types";

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
      className="bg-card text-card-foreground m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 shadow-xl backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
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

  function submit() {
    setError(null);
    const v = validateBlockForm(d, { single: editing });
    if (!v.ok) {
      setError(v.error);
      return;
    }
    startTransition(async () => {
      const r = editing ? await actions.modifierBloc(d.id, d) : await actions.ajouterBlocs(d);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const n = v.value.length;
      onSaved(
        editing
          ? `« ${v.value[0].title} » est modifié.`
          : `« ${v.value[0].title} » est ajouté${n > 1 ? ` (${n} jours)` : ""}.`,
      );
    });
  }

  function remove() {
    if (!d.id) return;
    const quoi = d.kind === "weekly" ? "toutes les semaines de ce bloc" : "ce bloc";
    if (!window.confirm(`Supprimer ${quoi} (« ${d.title} ») ?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await actions.supprimerBloc(d.id);
      if (!r.ok) setError(r.error);
      else onSaved(`« ${d.title} » est supprimé.`);
    });
  }

  return (
    <form
      method="dialog"
      className="flex flex-col gap-4 p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="bloc-titre-fenetre" className="text-lg font-semibold">
          {editing ? "Modifier le bloc" : "Nouveau bloc"}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fermer" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-titre">Titre</Label>
        <Input
          id="bloc-titre"
          value={d.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={BLOCK_TITLE_MAX}
          placeholder="ex. Chimie générale, Travail"
          autoComplete="off"
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloc-lieu">Lieu</Label>
        <select
          id="bloc-lieu"
          className={SELECT}
          value={d.placeId ?? ""}
          onChange={(e) => set("placeId", e.target.value || null)}
        >
          <option value="">{homeName ? `Maison (${homeName})` : "Maison"}</option>
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
          <Label htmlFor="bloc-debut">Début</Label>
          <select
            id="bloc-debut"
            className={SELECT}
            value={d.start}
            onChange={(e) => set("start", e.target.value)}
          >
            {START_OPTIONS.map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockFr(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloc-fin">Fin</Label>
          <select
            id="bloc-fin"
            className={SELECT}
            value={d.end}
            onChange={(e) => set("end", e.target.value)}
          >
            {END_OPTIONS.map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockFr(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Répétition</legend>
        <div className="grille-4-demi">
          {(
            [
              ["weekly", "Chaque semaine"],
              ["once", "Une seule fois"],
            ] as const
          ).map(([kind, label]) => (
            <label
              key={kind}
              className={cn(
                "bg-card flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2",
                d.kind === kind && "border-primary bg-accent font-medium",
              )}
            >
              <input
                type="radio"
                name="bloc-repetition"
                className="sr-only"
                checked={d.kind === kind}
                onChange={() => set("kind", kind)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {d.kind === "weekly" ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              {editing ? "Jour" : "Jours (coche tous les jours de ce cours)"}
            </legend>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => {
                const checked = d.weekdays.includes(w);
                return (
                  <label
                    key={w}
                    title={WEEKDAY_LONG[w]}
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
                      aria-label={WEEKDAY_LONG[w]}
                      onChange={() =>
                        set(
                          "weekdays",
                          editing
                            ? [w]
                            : checked
                              ? d.weekdays.filter((x) => x !== w)
                              : [...d.weekdays, w].sort(),
                        )
                      }
                    />
                    {WEEKDAY_SHORT[w].replace(".", "")}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grille-4-demi">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bloc-session-debut">Début de session</Label>
              <Input
                id="bloc-session-debut"
                type="date"
                value={d.sessionStart}
                onChange={(e) => set("sessionStart", e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bloc-session-fin">Fin de session</Label>
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
          <p className="text-muted-foreground -mt-2 text-xs">
            Le bloc revient chaque semaine entre ces deux dates (incluses), et plus après.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloc-date">Jour</Label>
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
          <span>
            Chevauche {overlaps.map((b) => `« ${b.title} »`).join(", ")}. Tu peux enregistrer quand
            même (les deux comptent comme occupés).
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        {editing && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive ml-auto"
            disabled={pending}
            onClick={remove}
          >
            <Trash2 /> Supprimer
          </Button>
        )}
      </div>
    </form>
  );
}
