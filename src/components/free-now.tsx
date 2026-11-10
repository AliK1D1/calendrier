"use client";

import { EmptyState } from "@/components/empty-state";
import { Coffee, Loader2, MapPin, Phone, Send, Zap } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { chercherLibresMaintenant } from "@/app/groupes/meetup-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FreeNowMatchView, FreeNowView } from "@/lib/meetups/freeNow";
import type { Result } from "@/lib/places/validation";
import { useI18n } from "@/lib/i18n/client";

type Search = (raw: unknown) => Promise<Result<FreeNowView>>;

interface Props {
  /** Chercher dans ce groupe seulement (page du groupe) ; sinon dans tous mes groupes. */
  groupId?: string;
  /** Action serveur (remplaçable pour une page de démonstration). */
  search?: Search;
  /** « Proposer ce moment » (page du groupe : ouvre le formulaire de plan). */
  onPropose?: (match: FreeNowMatchView) => void;
}

/**
 * Bouton « Je suis libre maintenant » : qui peut me voir dans les 2 prochaines heures, trajets
 * compris (en personne, sinon un appel).
 */
export function FreeNow({ groupId, search = chercherLibresMaintenant, onPropose }: Props) {
  const titleId = useId();
  const { t, tr } = useI18n();
  const tf = t.meetups.freeNow;
  const [view, setView] = useState<FreeNowView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await search(groupId ? { groupId } : {});
      if (r.ok) setView(r.value);
      else {
        setView(null);
        setError(r.error);
      }
    });
  }

  return (
    <section aria-labelledby={titleId} className="rangee flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="font-semibold">
            {tf.title}
          </h2>
          <p className="text-muted-foreground text-sm">{groupId ? tf.inGroup : tf.inGroups}</p>
        </div>
        <Button type="button" onClick={run} disabled={pending} className="min-h-11">
          {pending ? <Loader2 className="animate-spin" /> : <Zap />}
          {pending ? tf.searching : tf.whoIsFree}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/8 text-destructive rounded-lg border p-3 text-sm"
        >
          {tr(error)}
        </p>
      )}

      <div aria-live="polite">{view && <Results view={view} onPropose={onPropose} />}</div>
    </section>
  );
}

function Results({
  view,
  onPropose,
}: {
  view: FreeNowView;
  onPropose?: (match: FreeNowMatchView) => void;
}) {
  const { t } = useI18n();
  const tf = t.meetups.freeNow;
  const notes: string[] = [];
  if (view.incomplete.length > 0) {
    notes.push(tf.noHome(view.incomplete.join(", ")));
  }
  if (view.truncated) notes.push(tf.truncated);

  return (
    <div className="flex flex-col gap-2">
      {view.matches.length === 0 ? (
        <EmptyState icon={Coffee}>
          {view.checked === 0 ? tf.nobodyToCheck : tf.nobodyFree(view.windowLabel)}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm">{tf.count(view.matches.length, view.checked, view.windowLabel)}</p>
          <ul className="flex flex-col gap-2">
            {view.matches.map((m) => (
              <li key={m.personId} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{m.name}</span>
                  {m.kind === "call" ? (
                    <Badge variant="secondary">
                      <Phone /> {tf.call}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <MapPin /> {tf.inPerson}
                    </Badge>
                  )}
                  <span className="text-sm tabular-nums">{m.timeLabel}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {m.kind === "call"
                    ? tf.tooFar
                    : tf.travel(m.placeName ?? t.meetups.place, m.myTravel, m.theirTravel)}
                  {m.groups.length > 0 ? ` · ${m.groups.join(", ")}` : ""}
                </p>
                {onPropose && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => onPropose(m)}
                  >
                    <Send /> {t.meetups.propose}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.map((n) => (
        <p key={n} className="text-muted-foreground text-xs">
          {n}
        </p>
      ))}
    </div>
  );
}
