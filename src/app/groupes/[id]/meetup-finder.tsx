"use client";

import {
  CalendarSearch,
  Clock,
  HelpCircle,
  LayoutGrid,
  List,
  MapPin,
  Phone,
  Send,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GroupMember } from "@/lib/groups/queries";
import {
  type AlmostView,
  type CompromiseView,
  DEFAULT_BUFFER_MINUTES,
  MAX_BUFFER_MINUTES,
  MEETUP_DURATIONS,
  type MeetupDuration,
  type MeetupSearchView,
  type ProposalView,
  formatMinutesFr,
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
  /** « Proposer ce moment » sur une carte (avec les participants de la recherche). */
  onPropose?: (p: ProposalView, participantIds: string[]) => void;
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
const formatDuration = formatMinutesFr;

/** Moment visé par un compromis « Pourquoi pas ? » choisi : on le montre en premier. */
interface Focus {
  kind: "in-person" | "call";
  /** Lieu attendu (`null` : n'importe lequel). */
  placeId: string | null;
  start: string;
  end: string;
  /** Ce qui a changé, affiché au-dessus du moment (ex. « Durée réduite à 45 min »). */
  label: string;
}

/** Vrai si la proposition correspond au moment visé (même type, même lieu, chevauchement). */
function matchesFocus(p: ProposalView, f: Focus): boolean {
  return (
    p.kind === f.kind &&
    (f.placeId === null || p.placeId === f.placeId) &&
    p.start < f.end &&
    p.end > f.start
  );
}

export function MeetupFinder({
  groupId,
  myId,
  members,
  search = chercherMoments,
  onPropose,
}: Props) {
  const formId = useId();
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.userId));
  const [period, setPeriod] = useState<MeetupPeriod>("this-week");
  const [duration, setDuration] = useState<number>(60);
  const [buffer, setBuffer] = useState(String(DEFAULT_BUFFER_MINUTES));
  const [view, setView] = useState<MeetupSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"liste" | "grille">("liste");
  const [pending, startTransition] = useTransition();
  const [resultKey, setResultKey] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function run(
    params: { participantIds: string[]; durationMinutes: number },
    nextFocus: Focus | null,
  ) {
    setError(null);
    startTransition(async () => {
      const r = await search({
        groupId,
        participantIds: params.participantIds,
        period,
        durationMinutes: params.durationMinutes,
        bufferMinutes: Number(buffer),
      });
      if (r.ok) {
        setView(r.value);
        setFocus(nextFocus);
        setResultKey((k) => k + 1);
      } else {
        setView(null);
        setFocus(null);
        setError(r.error);
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run({ participantIds: selected, durationMinutes: duration }, null);
  }

  /**
   * Compromis « Pourquoi pas ? » : on change le formulaire en conséquence et on relance la
   * recherche ; le moment obtenu s'affiche en premier, prêt à proposer au groupe.
   */
  function applyCompromise(a: AlmostView, c: CompromiseView) {
    if (c.kind === "call") {
      setFocus({ kind: "call", placeId: null, start: c.start, end: c.end, label: "Appel" });
      return;
    }
    if (c.kind === "shorten") {
      setDuration(c.durationMinutes);
      run(
        { participantIds: selected, durationMinutes: c.durationMinutes },
        {
          kind: "in-person",
          placeId: a.placeId,
          start: a.start,
          end: a.end,
          label: `Durée réduite à ${formatDuration(c.durationMinutes)}`,
        },
      );
      return;
    }
    if (c.kind === "without") {
      const next = selected.filter((id) => id !== c.personId);
      setSelected(next);
      run(
        { participantIds: next, durationMinutes: duration },
        {
          kind: "in-person",
          placeId: a.placeId,
          start: c.start,
          end: c.end,
          label: `Sans ${c.name}`,
        },
      );
      return;
    }
    run(
      { participantIds: selected, durationMinutes: duration },
      {
        kind: "in-person",
        placeId: c.placeId,
        start: c.start,
        end: c.end,
        label: `À ${c.placeName}`,
      },
    );
  }

  const durations: number[] = MEETUP_DURATIONS.includes(duration as MeetupDuration)
    ? [...MEETUP_DURATIONS]
    : [...MEETUP_DURATIONS, duration].sort((a, b) => a - b);

  return (
    <section aria-labelledby="se-voir" className="flex flex-col gap-4">
      <h2 id="se-voir" className="scroll-mt-16 text-lg font-semibold">
        Quand on peut se voir
      </h2>
      <form
        onSubmit={submit}
        className="bg-card flex flex-col gap-4 rounded-lg border p-4"
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
                className="bg-card has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
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
          <div className="grille-4-demi">
            {MEETUP_PERIODS.map((p) => (
              <label
                key={p}
                className="bg-card has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-center text-sm"
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

        <div className="grille-4-demi">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Au moins
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="border-input bg-card h-11 rounded-md border px-3 text-base font-normal"
            >
              {durations.map((d) => (
                <option key={d} value={d}>
                  {DURATION_LABELS[d as MeetupDuration] ?? formatDuration(d)}
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
              className="border-input bg-card h-11 rounded-md border px-3 text-base font-normal"
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

      {view && (
        <MeetupResults
          key={resultKey}
          view={view}
          mode={mode}
          onMode={setMode}
          focus={focus}
          pending={pending}
          onCompromise={applyCompromise}
          onPropose={
            onPropose
              ? (p) =>
                  onPropose(
                    p,
                    view.participants.map((x) => x.id),
                  )
              : undefined
          }
        />
      )}
    </section>
  );
}

function MeetupResults({
  view,
  mode,
  onMode,
  focus,
  pending,
  onCompromise,
  onPropose,
}: {
  view: MeetupSearchView;
  mode: "liste" | "grille";
  onMode: (m: "liste" | "grille") => void;
  focus: Focus | null;
  pending: boolean;
  onCompromise: (a: AlmostView, c: CompromiseView) => void;
  onPropose?: (p: ProposalView) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const enough = view.participants.length >= 2;
  const nothing = view.inPerson.length === 0;
  const firstCall = [...view.calls].sort((a, b) => a.start.localeCompare(b.start))[0];
  const focused = focus
    ? (focus.kind === "call" ? view.calls : view.inPerson).find((p) => matchesFocus(p, focus))
    : undefined;
  const inPerson = focused ? view.inPerson.filter((p) => p !== focused) : view.inPerson;
  const calls = focused ? view.calls.filter((p) => p !== focused) : view.calls;

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {view.excluded.length > 0 && (
        <p className="border-warning/60 bg-warning/15 rounded-md border p-3 text-sm">
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
              {focus && !focused && (
                <p
                  role="status"
                  className="border-warning/60 bg-warning/15 rounded-md border p-3 text-sm"
                >
                  Ce compromis ne donne finalement pas de moment (l&apos;horaire a peut-être changé
                  entre-temps).
                </p>
              )}
              {focused && focus && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Avec ton compromis : {focus.label}</h3>
                  <ol className="flex flex-col gap-3">
                    <ProposalCard p={focused} onPropose={onPropose} highlight />
                  </ol>
                </div>
              )}
              {nothing && !focused && view.almost.length === 0 && (
                <p role="status" className="rounded-md border p-3 text-sm">
                  Pas de moment réaliste en personne sur cette période
                  {firstCall
                    ? `, voici un appel possible ${firstCall.dayLabel} à ${firstCall.timeLabel.split(" – ")[0]}.`
                    : ", et pas de trou commun assez long pour un appel. Essaie une durée plus courte ou l'autre semaine."}
                </p>
              )}
              {nothing && !focused && view.almost.length > 0 && (
                <WhyNot almost={view.almost} pending={pending} onCompromise={onCompromise} />
              )}
              <ol className="flex flex-col gap-3">
                {(showAll ? inPerson : inPerson.slice(0, FIRST_CARDS)).map((p) => (
                  <ProposalCard key={p.key} p={p} onPropose={onPropose} />
                ))}
              </ol>
              {!showAll && inPerson.length > FIRST_CARDS && (
                <Button type="button" variant="outline" onClick={() => setShowAll(true)}>
                  Voir les {inPerson.length} propositions
                </Button>
              )}
              {calls.length > 0 && (
                <>
                  <h3 className="mt-2 text-sm font-semibold">
                    {nothing ? "Appels possibles" : "Les autres jours, un appel"}
                  </h3>
                  <ol className="flex flex-col gap-3">
                    {calls.map((p) => (
                      <ProposalCard key={p.key} p={p} onPropose={onPropose} />
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

/**
 * « Pourquoi pas ? » (story 4) : aucun moment en personne, mais des moments presque assez
 * longs. Pour chacun : qui le coupe et pourquoi, puis les compromis (le plus petit d'abord).
 */
function WhyNot({
  almost,
  pending,
  onCompromise,
}: {
  almost: AlmostView[];
  pending: boolean;
  onCompromise: (a: AlmostView, c: CompromiseView) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="rounded-md border p-3 text-sm">
        Pas de moment assez long en personne sur cette période. Voici ce qui passe presque, et ce
        qui le débloquerait.
      </p>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <HelpCircle className="size-4" aria-hidden /> Pourquoi pas ?
      </h3>
      <ol className="flex flex-col gap-3">
        {almost.map((a) => (
          <li
            key={a.key}
            className="bg-card flex flex-col gap-2 rounded-lg border border-dashed p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-semibold first-letter:uppercase">{a.dayLabel}</p>
              <p className="tabular-nums">{a.timeLabel}</p>
            </div>
            <p className="flex items-center gap-1.5 text-sm">
              <MapPin className="size-4" aria-hidden /> {a.placeName}
              <Badge variant="outline" className="ml-auto">
                <Clock aria-hidden /> Il manque {formatDuration(a.missingMinutes)}
              </Badge>
            </p>
            <p className="text-sm">{a.sentence}</p>
            {a.compromises.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {a.compromises.map((c, i) => (
                  <Button
                    key={`${c.kind}-${i}`}
                    type="button"
                    variant={i === 0 ? "default" : "outline"}
                    disabled={pending}
                    onClick={() => onCompromise(a, c)}
                    className="h-auto min-h-11 whitespace-normal"
                  >
                    {c.label}
                    {i === 0 && <span className="sr-only"> (le plus simple)</span>}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Aucun petit compromis ne suffit pour ce moment.
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProposalCard({
  p,
  onPropose,
  highlight = false,
}: {
  p: ProposalView;
  onPropose?: (p: ProposalView) => void;
  /** Moment obtenu par un compromis : mis en évidence et amené à l'écran. */
  highlight?: boolean;
}) {
  const call = p.kind === "call";
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  return (
    <li
      ref={ref}
      className={`bg-card flex flex-col gap-2 rounded-lg border p-4 ${highlight ? "border-primary ring-primary/30 ring-2" : ""}`}
    >
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
      {onPropose && (
        <Button
          type="button"
          variant="outline"
          className="mt-1 sm:self-start"
          onClick={() => onPropose(p)}
        >
          <Send /> Proposer ce moment
        </Button>
      )}
    </li>
  );
}

function AvailabilityGridView({ view }: { view: MeetupSearchView }) {
  const total = view.participants.length;
  const shades = ["bg-muted", "bg-success/25", "bg-success/55", "bg-success"];
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
