"use client";

import { CalendarSync, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  const [message, setMessage] = useState(returnMessage);
  const [pending, startTransition] = useTransition();
  const [calendars, setCalendars] = useState<Extract<CalendarsResult, { ok: true }> | null>(null);
  const [choice, setChoice] = useState("");

  const run = (
    fn: () => Promise<{ ok: true; text?: string } | { ok: false; error: string }>,
    okText: string,
  ) => {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.text ?? okText } : { ok: false, text: r.error });
      router.refresh();
    });
  };

  return (
    <Card id="outlook" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSync className="size-5" aria-hidden /> Calendrier Outlook
        </CardTitle>
        <CardDescription>
          Connecte ton calendrier Outlook (compte personnel ou de travail/école) : tes événements
          comptent comme du temps occupé, sans les entrer à la main. Lecture seule : l&apos;app
          n&apos;écrit jamais dans ton Outlook. Tes amis voient seulement « Occupé », jamais les
          titres ni les lieux.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!dbReady ? (
          <p role="alert" className="text-destructive">
            La base de données n&apos;est pas à jour : applique supabase/migration-0014.sql (voir
            README).
          </p>
        ) : !status ? (
          <>
            <p className="text-muted-foreground">
              On lit ton calendrier principal (tu pourras en choisir un autre), de cette semaine
              jusqu&apos;à 8 semaines plus tard. La synchro se fait aux 15 minutes quand tu as
              l&apos;app ouverte, et quand tu cliques « Actualiser ».
            </p>
            {configured ? (
              <Button asChild className="sm:self-start">
                {/* Lien simple : la route redirige vers la page de connexion Microsoft. */}
                <a href="/api/outlook/connect">Connecter Outlook</a>
              </Button>
            ) : (
              <p className="text-muted-foreground">
                Outlook n&apos;est pas encore configuré sur ce site (clés Microsoft manquantes).
              </p>
            )}
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Compte</dt>
              <dd className="break-all">{status.accountEmail || "Compte Microsoft"}</dd>
              <dt className="text-muted-foreground">Calendrier</dt>
              <dd className="break-words">{status.calendarName || "Calendrier principal"}</dd>
              <dt className="text-muted-foreground">Dernière synchro</dt>
              <dd>{status.lastSynced ?? "pas encore"}</dd>
            </dl>
            {status.lastSyncError && (
              <p role="alert" className="text-destructive">
                {status.lastSyncError}
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
                    "Calendrier choisi.",
                  );
                  setCalendars(null);
                }}
              >
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-medium">Calendrier à lire</span>
                  <select
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    className="border-input bg-background h-10 rounded-md border px-3"
                  >
                    {calendars.calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isDefault ? " (principal)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={pending}>
                  Choisir
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCalendars(null)}>
                  Annuler
                </Button>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || !configured}
                onClick={() => run(actualiserOutlook, "Outlook synchronisé.")}
              >
                <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
                {pending ? "Un instant…" : "Actualiser maintenant"}
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
                        setMessage({ ok: false, text: r.error });
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
                  Choisir le calendrier
                </Button>
              )}
              {configured && status.lastSyncError && (
                <Button asChild variant="outline">
                  <a href="/api/outlook/connect">Reconnecter Outlook</a>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Déconnecter Outlook ? Tes blocs Outlook seront supprimés de l'app tout de suite.",
                    )
                  ) {
                    return;
                  }
                  run(deconnecterOutlook, "Outlook déconnecté : ses blocs sont supprimés.");
                }}
              >
                <Unplug aria-hidden /> Déconnecter
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
      </CardContent>
    </Card>
  );
}
