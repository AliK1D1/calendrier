"use client";

import { Loader2, MapPin, Phone, Send, Zap } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { chercherLibresMaintenant } from "@/app/groupes/meetup-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FreeNowMatchView, FreeNowView } from "@/lib/meetups/freeNow";
import type { Result } from "@/lib/places/validation";
import { plural } from "@/lib/ux/plural";

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
    <section
      aria-labelledby={titleId}
      className="bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="font-semibold">
            Je suis libre maintenant
          </h2>
          <p className="text-muted-foreground text-sm">
            {groupId
              ? "Qui, dans ce groupe, peut te voir d'ici 2 heures ?"
              : "Qui, dans tes groupes, peut te voir d'ici 2 heures ?"}
          </p>
        </div>
        <Button type="button" onClick={run} disabled={pending} className="min-h-11">
          {pending ? <Loader2 className="animate-spin" /> : <Zap />}
          {pending ? "Recherche…" : "Qui est libre ?"}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
        >
          {error}
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
  const notes: string[] = [];
  if (view.incomplete.length > 0) {
    notes.push(`Sans lieu « maison », donc pas comptés : ${view.incomplete.join(", ")}.`);
  }
  if (view.truncated) notes.push("Seuls les 10 premiers groupes et 40 membres ont été vérifiés.");

  return (
    <div className="flex flex-col gap-2">
      {view.matches.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          {view.checked === 0
            ? "Personne d'autre à vérifier pour l'instant : invite des amis dans un groupe."
            : `Personne n'est libre en même temps que toi entre ${view.windowLabel} (au moins 30 min, trajets compris).`}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {plural(view.matches.length, "personne")} sur {view.checked} entre {view.windowLabel} :
          </p>
          <ul className="flex flex-col gap-2">
            {view.matches.map((m) => (
              <li key={m.personId} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{m.name}</span>
                  {m.kind === "call" ? (
                    <Badge variant="secondary">
                      <Phone /> Appel
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <MapPin /> En personne
                    </Badge>
                  )}
                  <span className="text-sm tabular-nums">{m.timeLabel}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {m.kind === "call"
                    ? "Trop loin pour se rejoindre à temps : un appel ou une visio."
                    : `${m.placeName ?? "Lieu"} · ton trajet ${m.myTravel} min, le sien ${m.theirTravel} min`}
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
                    <Send /> Proposer ce moment
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
