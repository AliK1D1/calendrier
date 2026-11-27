"use client";

import { CalendarSync, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";

import {
  actualiserOutlook,
  type CalendarsResult,
  choisirCalendrierOutlook,
  deconnecterOutlook,
  listerCalendriersOutlook,
} from "./outlook-actions";

export interface OutlookCardProps {
  /** Le site a les clés Microsoft (sinon : bouton désactivé, explication). */
  configured: boolean;
  /** Migration 0014 appliquée. */
  dbReady: boolean;
  status: {
    accountEmail: string;
    calendarName: string;
    /** Déjà mis en forme (« il y a 5 min »), ou null : jamais. */
    lastSynced: string | null;
    lastSyncError: string;
  } | null;
  /** Message au retour de Microsoft (paramètre `?outlook=`). */
  returnMessage: { ok: boolean; text: string } | null;
}

/** Carte « Calendrier Outlook » de la page Profil. */
export function OutlookCard({ configured, dbReady, status, returnMessage }: OutlookCardProps) {
  const router = useRouter();
  const { t, tr } = useI18n();
  const to = t.profile.outlook;
  const [message, setMessage] = useState(returnMessage);
  const [pending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<Extract<CalendarsResult, { ok: true }> | null>(null);
  const [choice, setChoice] = useState("");
  const { confirm, confirmDialog } = useConfirm();

  const run = (
    fn: () => Promise<{ ok: true; text?: string } | { ok: false; error: string }>,
    okText: string,
  ) => {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      setMessage(
        r.ok ? { ok: true, text: r.text ? tr(r.text) : okText } : { ok: false, text: tr(r.error) },
      );
      router.refresh();
    });
  };

  return (
    <Card id="outlook" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSync className="size-5" aria-hidden /> {to.title}
        </CardTitle>
        <CardDescription>{to.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!dbReady ? (
          <p role="alert" className="text-destructive">
            {t.profile.dbOutdated("0014")}
          </p>
        ) : !status ? (
          <>
            <p className="text-muted-foreground">{to.intro}</p>
            {configured ? (
              <Button asChild className="sm:self-start">
                {/* Lien simple : la route redirige vers la page de connexion Microsoft. */}
                <a href="/api/outlook/connect">{to.connect}</a>
              </Button>
            ) : (
              <p className="text-muted-foreground">{to.notConfigured}</p>
            )}
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{to.account}</dt>
              <dd className="break-all">{status.accountEmail || to.microsoftAccount}</dd>
              <dt className="text-muted-foreground">{to.calendar}</dt>
              <dd className="break-words">{status.calendarName || to.mainCalendar}</dd>
              <dt className="text-muted-foreground">{to.lastSync}</dt>
              <dd>{status.lastSynced ?? to.notYet}</dd>
            </dl>
            {status.lastSyncError && (
              <p role="alert" className="text-destructive">
                {tr(status.lastSyncError)}
              </p>
            )}
            {calendars && (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  const picked = calendars.calendars.find((c) => c.id === choice);
                  run(
                    () => choisirCalendrierOutlook(picked && !picked.isDefault ? picked.id : null),
                    to.chosen,
                  );
                  setCalendars(null);
                }}
              >
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-medium">{to.calendarToRead}</span>
                  <select
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    className="border-input bg-background h-10 rounded-md border px-3"
                  >
                    {calendars.calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isDefault ? to.mainSuffix : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={pending}>
                  {to.choose}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCalendars(null)}>
                  {t.common.cancel}
                </Button>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || !configured}
                onClick={() => run(actualiserOutlook, to.synced)}
              >
                <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
                {pending ? to.oneMoment : to.refreshNow}
              </Button>
              {!calendars && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !configured}
                  onClick={() => {
                    setMessage(null);
                    startTransition(async () => {
                      const r = await listerCalendriersOutlook();
                      if (!r.ok) {
                        setMessage({ ok: false, text: tr(r.error) });
                        return;
                      }
                      setCalendars(r);
                      const current =
                        r.calendars.find((c) => c.id === r.current) ??
                        r.calendars.find((c) => c.isDefault) ??
                        r.calendars[0];
                      setChoice(current?.id ?? "");
                    });
                  }}
                >
                  {to.chooseCalendar}
                </Button>
              )}
              {configured && status.lastSyncError && (
                <Button asChild variant="outline">
                  <a href="/api/outlook/connect">{to.reconnect}</a>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={async () => {
                  const yes = await confirm({
                    message: to.confirmDisconnect,
                    action: to.disconnect,
                  });
                  if (!yes) return;
                  run(deconnecterOutlook, to.disconnected);
                }}
              >
                <Unplug aria-hidden /> {to.disconnect}
              </Button>
            </div>
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
