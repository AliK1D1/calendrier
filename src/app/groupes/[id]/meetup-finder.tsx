"use client";

import { CalendarSearch, Clock, LayoutGrid, List, MapPin, Phone } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GroupMember } from "@/lib/groups/queries";
import {
  DEFAULT_BUFFER_MINUTES,
  MAX_BUFFER_MINUTES,
  MEETUP_DURATIONS,
  type MeetupDuration,
  type MeetupSearchView,
  type ProposalView,
} from "@/lib/meetups/search";
import type { Result } from "@/lib/places/validation";
import { MEETUP_PERIOD_LABELS, MEETUP_PERIODS, type MeetupPeriod } from "@/lib/scheduling/period";
import { plural } from "@/lib/ux/plural";

import { chercherMoments } from "../meetup-actions";

type Search = (raw: unknown) => Promise<Result<MeetupSearchView>>;

interface Props {
  groupId: string;
  myId: string;
  members: Pick<GroupMember, "userId" | "displayName">[];
  /** Action serveur de recherche (remplaçable pour une page de démonstration). */
  search?: Search;
}

/** Propositions montrées avant « Voir les N propositions ». */
const FIRST_CARDS = 6;

const DURATION_LABELS: Record<MeetupDuration, string> = {
  30: "30 min",
  45: "45 min",
  60: "1 h",
  90: "1 h 30",
  120: "2 h",
};

/** « 75 » → « 1 h 15 ». */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

export function MeetupFinder({ groupId, myId, members, search = chercherMoments }: Props) {
  const formId = useId();
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.userId));
  const [period, setPeriod] = useState<MeetupPeriod>("this-week");
  const [duration, setDuration] = useState<MeetupDuration>(60);
  const [buffer, setBuffer] = useState(String(DEFAULT_BUFFER_MINUTES));
  const [view, setView] = useState<MeetupSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"liste" | "grille">("liste");
  const [pending, startTransition] = useTransition();
  const [resultKey, setResultKey] = useState(0);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await search({
        groupId,
        participantIds: selected,
        period,
        durationMinutes: duration,
        bufferMinutes: Number(buffer),
      });
      if (r.ok) {
        setView(r.value);
        setResultKey((k) => k + 1);
      } else {
        setView(null);
        setError(r.error);
      }
    });
  }

  return (
    <section aria-labelledby="se-voir" className="flex flex-col gap-4">
      <h2 id="se-voir" className="scroll-mt-16 text-lg font-semibold">
        Quand on peut se voir
      </h2>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border p-4"
        aria-describedby={`${formId}-aide`}
      >
        <p id={`${formId}-aide`} className="text-muted-foreground text-sm">
          Des moments où tout le monde peut vraiment être là, trajets compris.
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Qui participe ?</legend>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <label
                key={m.userId}
                className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(m.userId)}
                  onChange={() => toggle(m.userId)}
                  className="size-4"
                />
                {m.displayName}
                {m.userId === myId ? " (toi)" : ""}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Période</legend>
          <div className="grid grid-cols-2 gap-2">
            {MEETUP_PERIODS.map((p) => (
              <label
                key={p}
                className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-center text-sm"
              >
                <input
                  type="radio"
                  name={`${formId}-periode`}
                  value={p}
                  checked={period === p}
                  onChange={() => setPeriod(p)}
                  className="sr-only"
                />
                {MEETUP_PERIOD_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Au moins
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) as MeetupDuration)}
              className="border-input bg-background h-11 rounded-md border px-3 text-base font-normal"
            >
              {MEETUP_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {DURATION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Marge par trajet (min)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_BUFFER_MINUTES}
              step={1}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              aria-describedby={`${formId}-marge`}
              className="border-input bg-background h-11 rounded-md border px-3 text-base font-normal"
            />
          </label>
        </div>
        <p id={`${formId}-marge`} className="text-muted-foreground -mt-2 text-xs">
          Minutes ajoutées à chaque trajet pour les imprévus (attendre le bus, trouver où se garer).
        </p>

        <Button type="submit" size="lg" disabled={pending || selected.length < 2}>
          <CalendarSearch /> {pending ? "Calcul en cours…" : "Trouver des moments"}
        </Button>
        {selected.length < 2 && (
          <p className="text-muted-foreground text-sm">Choisis au moins deux participants.</p>
        )}
      </form>

      {error && (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}

      {view && <MeetupResults key={resultKey} view={view} mode={mode} onMode={setMode} />}
    </section>
  );
}

function MeetupResults({
  view,
  mode,
  onMode,
}: {
  view: MeetupSearchView;
  mode: "liste" | "grille";
  onMode: (m: "liste" | "grille") => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const enough = view.participants.length >= 2;
  const nothing = view.inPerson.length === 0;
  const firstCall = [...view.calls].sort((a, b) => a.start.localeCompare(b.start))[0];

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {view.excluded.length > 0 && (
        <p className="rounded-md border border-amber-500/40 p-3 text-sm">
          Pas dans le calcul : {view.excluded.map((x) => `${x.name} (${x.reason})`).join(", ")}.
        </p>
      )}
      {view.hiddenPlaceBlocks.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Certains lieux ne te sont pas visibles (
          {view.hiddenPlaceBlocks.map((h) => `${h.name} : ${plural(h.count, "bloc")}`).join(", ")})
          : on compte ces moments comme occupés, à la maison de la personne.
        </p>
      )}

      {!enough ? (
        <p role="status" className="rounded-md border p-3 text-sm">
          Il faut au moins deux participants prêts pour chercher un moment.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {plural(view.inPerson.length, "moment en personne", "moments en personne")}
              {view.calls.length > 0 ? ` · ${plural(view.calls.length, "appel")}` : ""}
            </p>
            <div className="flex gap-1" role="group" aria-label="Affichage">
              <Button
                type="button"
                size="sm"
                variant={mode === "liste" ? "secondary" : "ghost"}
                aria-pressed={mode === "liste"}
                onClick={() => onMode("liste")}
              >
                <List /> Liste
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "grille" ? "secondary" : "ghost"}
                aria-pressed={mode === "grille"}
                onClick={() => onMode("grille")}
              >
                <LayoutGrid /> Grille
              </Button>
            </div>
          </div>

          {mode === "grille" ? (
            <AvailabilityGridView view={view} />
          ) : (
            <>
              {nothing && (
                <p role="status" className="rounded-md border p-3 text-sm">
                  Pas de moment réaliste en personne sur cette période
                  {firstCall
                    ? `, voici un appel possible ${firstCall.dayLabel} à ${firstCall.timeLabel.split(" – ")[0]}.`
                    : ", et pas de trou commun assez long pour un appel. Essaie une durée plus courte ou l'autre semaine."}
                </p>
              )}
              <ol className="flex flex-col gap-3">
                {(showAll ? view.inPerson : view.inPerson.slice(0, FIRST_CARDS)).map((p) => (
                  <ProposalCard key={p.key} p={p} />
                ))}
              </ol>
              {!showAll && view.inPerson.length > FIRST_CARDS && (
                <Button type="button" variant="outline" onClick={() => setShowAll(true)}>
                  Voir les {view.inPerson.length} propositions
                </Button>
              )}
              {view.calls.length > 0 && (
                <>
                  <h3 className="mt-2 text-sm font-semibold">
                    {nothing ? "Appels possibles" : "Les autres jours, un appel"}
                  </h3>
                  <ol className="flex flex-col gap-3">
                    {view.calls.map((p) => (
                      <ProposalCard key={p.key} p={p} />
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ProposalCard({ p }: { p: ProposalView }) {
  const call = p.kind === "call";
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold first-letter:uppercase">{p.dayLabel}</p>
        <p className="tabular-nums">{p.timeLabel}</p>
      </div>
      <p className="flex items-center gap-1.5 text-sm">
        {call ? (
          <>
            <Phone className="size-4" aria-hidden /> Appel ou visio
          </>
        ) : (
          <>
            <MapPin className="size-4" aria-hidden /> {p.placeName}
          </>
        )}
        <Badge variant="outline" className="ml-auto">
          <Clock aria-hidden /> {formatDuration(p.durationMinutes)}
        </Badge>
      </p>
      {!call && (
        <p className="text-muted-foreground text-sm">
          Trajet :{" "}
          {p.travel.map((t, i) => (
            <span key={t.personId}>
              {i > 0 && ", "}
              <span className="text-foreground">
                {t.name} : {t.to} min
              </span>
              {t.from !== t.to && <span> (retour {t.from} min)</span>}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

function AvailabilityGridView({ view }: { view: MeetupSearchView }) {
  const total = view.participants.length;
  const shades = ["bg-muted", "bg-emerald-100", "bg-emerald-300", "bg-emerald-600"];
  const shade = (n: number) =>
    n === 0 ? shades[0] : n === total ? shades[3] : n / total >= 0.5 ? shades[2] : shades[1];
  // Case touchée : on affiche qui est libre (le « title » ne s'affiche pas au doigt).
  const [picked, setPicked] = useState<{ day: string; start: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Qui est libre, par demi-heure (sans compter les trajets). Touche une case pour voir qui.
      </p>
      <ul
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
        aria-label="Légende"
      >
        {[
          [shades[3], "Tout le monde"],
          [shades[2], "La moitié ou plus"],
          [shades[1], "Moins de la moitié"],
          [shades[0], "Personne"],
        ].map(([cls, label]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className={`size-3 rounded-sm border ${cls}`} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
      {view.grid.map((d) => {
        const slot =
          picked?.day === d.day ? d.slots.find((s) => s.start === picked.start) : undefined;
        return (
          <div key={d.day} className="flex flex-col gap-1">
            <p className="text-sm font-medium first-letter:uppercase">{d.dayLabel}</p>
            <div
              className="grid gap-px"
              style={{ gridTemplateColumns: `repeat(${d.slots.length}, minmax(0, 1fr))` }}
              role="group"
              aria-label={d.dayLabel}
            >
              {d.slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  title={`${s.label} : ${s.free.length ? s.free.join(", ") : "personne"}`}
                  aria-label={`${s.label} : ${s.free.length} sur ${total} libres`}
                  aria-pressed={slot?.start === s.start}
                  onClick={() =>
                    setPicked(slot?.start === s.start ? null : { day: d.day, start: s.start })
                  }
                  className={`h-6 rounded-sm ${shade(s.free.length)} aria-pressed:ring-foreground aria-pressed:ring-2`}
                />
              ))}
            </div>
            <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
              <span>{d.slots[0]?.label.split(" – ")[0]}</span>
              <span>{d.slots.at(-1)?.label.split(" – ")[1]}</span>
            </div>
            {slot && (
              <p className="text-sm" role="status">
                <span className="tabular-nums">{slot.label}</span> :{" "}
                {slot.free.length === 0
                  ? "personne n'est libre."
                  : slot.free.length === total
                    ? "tout le monde est libre."
                    : `libres : ${slot.free.join(", ")}.`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
