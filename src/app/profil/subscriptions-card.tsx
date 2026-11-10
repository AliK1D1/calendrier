"use client";

import { CalendarPlus, RefreshCw, Rss, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import {
  actualiserAbonnement,
  ajouterAbonnement,
  ajouterAbonnementOutlook,
  changerOccupeAbonnement,
  listerCalendriersOutlookAbonnables,
  type OutlookCandidatesResult,
  retirerAbonnement,
} from "./subscription-actions";

export interface SubscriptionItem {
  id: string;
  kind: "ics" | "outlook";
  name: string;
  source: string;
  countsAsBusy: boolean;
  /** Déjà mis en forme (« il y a 2 h »), ou null : jamais. */
  lastSynced: string | null;
  lastSyncError: string;
}

export interface SubscriptionsCardProps {
  /** Migration 0017 appliquée. */
  dbReady: boolean;
  items: SubscriptionItem[];
  /** Outlook connecté (et configuré) : on peut ajouter ses calendriers. */
  outlookConnected: boolean;
  max: number;
}

type Msg = { ok: boolean; text: string } | null;
type Res = { ok: true; text?: string } | { ok: false; error: string };

/** Choix obligatoire « compte comme occupé » (aucune valeur par défaut). */
function BusyChoice({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium">
        Ces événements comptent-ils comme du temps occupé ?
      </legend>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={value === true}
          onChange={() => onChange(true)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <strong>Oui, je suis occupé</strong> : l&apos;app ne propose rien à ces heures (tes amis
          voient « Occupé »).
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={value === false}
          onChange={() => onChange(false)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <strong>Non, juste pour voir</strong> : affichés dans mon horaire, sans bloquer mon temps
          libre (ex. les courses de F1). Personne d&apos;autre ne les voit.
        </span>
      </label>
    </fieldset>
  );
}

/** Carte « Calendriers en ligne » de la page Profil (story 3). */
export function SubscriptionsCard({
  dbReady,
  items,
  outlookConnected,
  max,
}: SubscriptionsCardProps) {
  const router = useRouter();
  const [message, setMessage] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<boolean | null>(null);
  const [outlook, setOutlook] = useState<Extract<OutlookCandidatesResult, { ok: true }> | null>(
    null,
  );
  const [outlookChoice, setOutlookChoice] = useState("");
  const [outlookBusy, setOutlookBusy] = useState<boolean | null>(null);
  const full = items.length >= max;
  const { confirm, confirmDialog } = useConfirm();

  const run = (fn: () => Promise<Res>, after?: () => void) => {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.text ?? "C'est fait." } : { ok: false, text: r.error });
      if (r.ok) after?.();
      router.refresh();
    });
  };

  return (
    <Card id="abonnements" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="size-5" aria-hidden /> Calendriers en ligne
        </CardTitle>
        <CardDescription>
          Abonne-toi à un calendrier qui se met à jour tout seul (horaire de la Formule 1, de ton
          équipe, fêtes…), avec ou sans Outlook. Tu choisis s&apos;il compte comme du temps occupé.
          Personne d&apos;autre ne voit tes calendriers abonnés.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {!dbReady ? (
          <p role="alert" className="text-destructive">
            La base de données n&apos;est pas à jour : applique supabase/migration-0017.sql (voir
            README).
          </p>
        ) : (
          <>
            {items.length > 0 && (
              <ul className="flex flex-col gap-3">
                {items.map((s) => (
                  <li key={s.id} className="rangee flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words">{s.name}</span>
                      <Badge variant="secondary">{s.source}</Badge>
                      {!s.countsAsBusy && <Badge variant="outline">juste pour voir</Badge>}
                    </div>
                    <p className="text-muted-foreground">
                      Dernière mise à jour : {s.lastSynced ?? "pas encore"}
                    </p>
                    {s.lastSyncError && (
                      <p role="alert" className="text-destructive flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>
                          {s.lastSyncError} On garde la dernière version connue
                          {s.lastSynced ? ` (${s.lastSynced})` : ""}. Si le lien ne marche plus,
                          retire ce calendrier.
                        </span>
                      </p>
                    )}
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={s.countsAsBusy}
                        disabled={pending}
                        onChange={(e) => {
                          const v = e.target.checked;
                          run(() => changerOccupeAbonnement(s.id, v));
                        }}
                        className="mt-0.5 size-4 shrink-0"
                      />
                      <span>Compte comme du temps occupé</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(() => actualiserAbonnement(s.id))}
                      >
                        <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
                        Actualiser
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={async () => {
                          const yes = await confirm({
                            message: `Retirer « ${s.name} » ? Ses événements ne seront plus affichés ni utilisés.`,
                            action: "Retirer",
                          });
                          if (!yes) return;
                          run(() => retirerAbonnement(s.id));
                        }}
                      >
                        <Trash2 aria-hidden /> Retirer
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {full ? (
              <p className="text-muted-foreground">
                Tu as atteint {max} calendriers abonnés : retires-en un pour en ajouter un autre.
              </p>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy === null) {
                    setMessage({
                      ok: false,
                      text: "Choisis si ce calendrier compte comme du temps occupé.",
                    });
                    return;
                  }
                  run(
                    () => ajouterAbonnement({ url, name, countsAsBusy: busy }),
                    () => {
                      setUrl("");
                      setName("");
                      setBusy(null);
                    },
                  );
                }}
              >
                <h3 className="font-semibold">Ajouter par un lien</h3>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Lien du calendrier (.ics ou webcal://)</span>
                  <Input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    maxLength={2000}
                    placeholder="webcal://exemple.com/calendrier.ics"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <span className="text-muted-foreground text-xs">
                    Sur le site du calendrier, cherche « S&apos;abonner », « iCal » ou « Ajouter à
                    Outlook / Google », puis copie le lien. Attention : un lien secret (ex. «
                    adresse secrète iCal » de Google) donne accès à tout ce calendrier ; ne le
                    partage avec personne d&apos;autre.
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Nom (facultatif)</span>
                  <Input
                    type="text"
                    maxLength={100}
                    placeholder="Ex. Formule 1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <BusyChoice value={busy} onChange={setBusy} />
                <Button type="submit" disabled={pending} className="sm:self-start">
                  <CalendarPlus aria-hidden /> {pending ? "Un instant…" : "Ajouter le calendrier"}
                </Button>
              </form>
            )}

            {outlookConnected && !full && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <h3 className="font-semibold">Depuis ton compte Outlook</h3>
                <p className="text-muted-foreground">
                  Les calendriers auxquels tu es abonné dans Outlook (et tes autres calendriers)
                  apparaissent ici. Les titres des événements ne sont pas lus : ils portent le nom
                  du calendrier.
                </p>
                {!outlook ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    className="sm:self-start"
                    onClick={() => {
                      setMessage(null);
                      startTransition(async () => {
                        const r = await listerCalendriersOutlookAbonnables();
                        if (!r.ok) {
                          setMessage({ ok: false, text: r.error });
                          return;
                        }
                        if (r.calendars.length === 0) {
                          setMessage({
                            ok: true,
                            text: "Aucun autre calendrier dans ton compte Outlook.",
                          });
                          return;
                        }
                        setOutlook(r);
                        setOutlookChoice(r.calendars[0].id);
                        setOutlookBusy(null);
                      });
                    }}
                  >
                    Voir mes calendriers Outlook
                  </Button>
                ) : (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (outlookBusy === null) {
                        setMessage({
                          ok: false,
                          text: "Choisis si ce calendrier compte comme du temps occupé.",
                        });
                        return;
                      }
                      run(
                        () =>
                          ajouterAbonnementOutlook({
                            calendarId: outlookChoice,
                            countsAsBusy: outlookBusy,
                          }),
                        () => setOutlook(null),
                      );
                    }}
                  >
                    <label className="flex flex-col gap-1">
                      <span className="font-medium">Calendrier Outlook</span>
                      <select
                        value={outlookChoice}
                        onChange={(e) => setOutlookChoice(e.target.value)}
                        className="border-input bg-background h-10 rounded-md border px-3"
                      >
                        {outlook.calendars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.readOnly ? " (abonné)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BusyChoice value={outlookBusy} onChange={setOutlookBusy} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={pending}>
                        <CalendarPlus aria-hidden /> Ajouter
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setOutlook(null)}>
                        Annuler
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <p className="text-muted-foreground text-xs">
              On lit 8 semaines à partir de cette semaine. Mise à jour automatique aux 6 heures
              quand tu as l&apos;app ouverte, ou avec « Actualiser ». Si un lien ne répond plus, on
              garde la dernière version et on t&apos;avertit ici.
            </p>
          </>
        )}
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-success" : "text-destructive"}
          >
            {message.text}
          </p>
        )}
        {confirmDialog}
      </CardContent>
    </Card>
  );
}
