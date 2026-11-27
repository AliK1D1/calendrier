"use client";

import { CalendarPlus, RefreshCw, Rss, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
  const ts = t.profile.subscriptions;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium">{ts.busyQuestion}</legend>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={value === true}
          onChange={() => onChange(true)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <strong>{ts.busyYes}</strong>
          {ts.busyYesHint}
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
          <strong>{ts.busyNo}</strong>
          {ts.busyNoHint}
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
  const { t, tr } = useI18n();
  const ts = t.profile.subscriptions;
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
      setMessage(
        r.ok ? { ok: true, text: r.text ? tr(r.text) : ts.done } : { ok: false, text: tr(r.error) },
      );
      if (r.ok) after?.();
      router.refresh();
    });
  };

  return (
    <Card id="abonnements" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="size-5" aria-hidden /> {ts.title}
        </CardTitle>
        <CardDescription>{ts.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {!dbReady ? (
          <p role="alert" className="text-destructive">
            {t.profile.dbOutdated("0017")}
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
                      {!s.countsAsBusy && <Badge variant="outline">{ts.justToSee}</Badge>}
                    </div>
                    <p className="text-muted-foreground">
                      {ts.lastUpdate(s.lastSynced ?? ts.notYet)}
                    </p>
                    {s.lastSyncError && (
                      <p role="alert" className="text-destructive flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>
                          {tr(s.lastSyncError)}
                          {ts.keepLast(s.lastSynced)}
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
                      <span>{ts.countsAsBusy}</span>
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
                        {ts.refresh}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={async () => {
                          const yes = await confirm({
                            message: ts.confirmRemove(s.name),
                            action: ts.remove,
                          });
                          if (!yes) return;
                          run(() => retirerAbonnement(s.id));
                        }}
                      >
                        <Trash2 aria-hidden /> {ts.remove}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {full ? (
              <p className="text-muted-foreground">{ts.full(max)}</p>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy === null) {
                    setMessage({
                      ok: false,
                      text: ts.chooseBusy,
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
                <h3 className="font-semibold">{ts.addByLink}</h3>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">{ts.link}</span>
                  <Input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    maxLength={2000}
                    placeholder={ts.linkPlaceholder}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <span className="text-muted-foreground text-xs">{ts.linkHint}</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">{ts.name}</span>
                  <Input
                    type="text"
                    maxLength={100}
                    placeholder={ts.namePlaceholder}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <BusyChoice value={busy} onChange={setBusy} />
                <Button type="submit" disabled={pending} className="sm:self-start">
                  <CalendarPlus aria-hidden /> {pending ? ts.oneMoment : ts.add}
                </Button>
              </form>
            )}

            {outlookConnected && !full && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <h3 className="font-semibold">{ts.fromOutlook}</h3>
                <p className="text-muted-foreground">{ts.fromOutlookHint}</p>
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
                          setMessage({ ok: false, text: tr(r.error) });
                          return;
                        }
                        if (r.calendars.length === 0) {
                          setMessage({
                            ok: true,
                            text: ts.noOtherOutlook,
                          });
                          return;
                        }
                        setOutlook(r);
                        setOutlookChoice(r.calendars[0].id);
                        setOutlookBusy(null);
                      });
                    }}
                  >
                    {ts.seeOutlook}
                  </Button>
                ) : (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (outlookBusy === null) {
                        setMessage({
                          ok: false,
                          text: ts.chooseBusy,
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
                      <span className="font-medium">{ts.outlookCalendar}</span>
                      <select
                        value={outlookChoice}
                        onChange={(e) => setOutlookChoice(e.target.value)}
                        className="border-input bg-background h-10 rounded-md border px-3"
                      >
                        {outlook.calendars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.readOnly ? ts.subscribedSuffix : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BusyChoice value={outlookBusy} onChange={setOutlookBusy} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={pending}>
                        <CalendarPlus aria-hidden /> {ts.addShort}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setOutlook(null)}>
                        {t.common.cancel}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <p className="text-muted-foreground text-xs">{ts.footer}</p>
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
