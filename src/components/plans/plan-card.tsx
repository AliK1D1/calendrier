"use client";

import {
  AlertTriangle,
  Bike,
  Bus,
  CalendarPlus,
  Car,
  Check,
  Clock,
  Footprints,
  MapPin,
  Repeat,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeaveByView } from "@/lib/plans/leaveBy";
import type { PlanView } from "@/lib/plans/view";
import { cn } from "@/lib/utils";

const MODE_ICON = { walk: Footprints, bike: Bike, transit: Bus, car: Car } as const;

/** Story 6 : quand partir de mon lieu d'avant (seulement pour moi). */
function LeaveBy({ leaveBy: l }: { leaveBy: LeaveByView }) {
  const Icon = MODE_ICON[l.mode];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        l.warning ? "border-warning/70 bg-warning/10" : "bg-muted/40",
      )}
      aria-label="Quand partir"
    >
      <Icon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium break-words">
          {l.main}
          {l.detail && <span className="text-muted-foreground font-normal"> · {l.detail}</span>}
        </p>
        {l.urgent && <p className="text-primary font-semibold">{l.urgent}</p>}
        {l.transit && <p className="break-words">{l.transit}</p>}
        {l.warning && (
          <p className="flex items-start gap-1.5 font-medium" role="note">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{l.warning}</span>
          </p>
        )}
        {l.note && <p className="text-muted-foreground text-xs">{l.note}</p>}
      </div>
    </div>
  );
}

interface Props {
  plan: PlanView;
  pending: boolean;
  onRespond: (accept: boolean) => void;
  onCancel: () => void;
  /** Montrer le nom du groupe (page « Mes plans »). */
  showGroup?: boolean;
}

function status(p: PlanView): { label: string; className: string } {
  const series = p.repeatLabel !== null;
  if (p.state === "cancelled")
    return {
      label: series ? "Série arrêtée" : "Annulé",
      className: "bg-muted text-muted-foreground",
    };
  if (p.state === "past")
    return {
      label: series ? "Série terminée" : "Passé",
      className: "bg-muted text-muted-foreground",
    };
  if (p.isMine) return { label: "Ta proposition", className: "bg-primary/10 text-primary" };
  if (!p.invited) return { label: "Pour info", className: "bg-muted text-muted-foreground" };
  if (p.myResponse === "yes") return { label: "Accepté", className: "bg-success/15 text-success" };
  if (p.myResponse === "no")
    return { label: "Refusé", className: "bg-muted text-muted-foreground" };
  return { label: "À toi de répondre", className: "bg-warning/20 text-foreground" };
}

/** Carte d'un plan : quand, où, qui vient, et mes boutons (accepter, refuser, annuler…). */
export function PlanCard({ plan: p, pending, onRespond, onCancel, showGroup }: Props) {
  const s = status(p);
  const live = p.state === "upcoming";
  const awaiting = live && p.invited && !p.isMine && p.myResponse === null;
  const going = live && (p.myResponse === "yes" || p.isMine);
  const series = p.repeatLabel !== null;
  return (
    <li
      className={cn(
        "bg-card flex flex-col gap-2 rounded-lg border p-4",
        awaiting && "border-warning/70",
        !live && "opacity-75",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn("font-semibold break-words", p.state === "cancelled" && "line-through")}>
          {p.title}
        </p>
        <Badge className={cn("border-transparent", s.className)}>{s.label}</Badge>
      </div>
      {p.repeatLabel && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <Repeat className="text-primary size-4 shrink-0" aria-hidden />
          <span>{p.repeatLabel}</span>
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <Clock className="text-muted-foreground size-4" aria-hidden />
        <span className="first-letter:uppercase">
          {p.repeatLabel && live ? `Prochaine fois : ${p.dayLabel}` : p.dayLabel}
        </span>
        <span className="tabular-nums">· {p.timeLabel}</span>
      </p>
      <p className="flex items-center gap-2 text-sm">
        <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="break-words">{p.where}</span>
      </p>
      {live && p.leaveBy && <LeaveBy leaveBy={p.leaveBy} />}
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Proposé par {p.isMine ? "toi" : p.creatorName}
          {showGroup && (
            <>
              {" "}
              dans{" "}
              <Link href={`/groupes/${p.groupId}`} className="underline underline-offset-2">
                {p.groupName}
              </Link>
            </>
          )}
          {" · "}
          {p.wholeGroup
            ? "tout le groupe"
            : `${p.accepted.length + p.declined.length + p.waiting.length} invités`}
        </span>
      </p>
      <ul className="flex flex-col gap-0.5 text-sm" aria-label="Réponses">
        {p.accepted.length > 0 && (
          <li>
            <span className="text-success font-medium">Oui :</span> {p.accepted.join(", ")}
          </li>
        )}
        {p.declined.length > 0 && (
          <li>
            <span className="text-muted-foreground font-medium">Non :</span> {p.declined.join(", ")}
          </li>
        )}
        {p.waiting.length > 0 && live && (
          <li>
            <span className="text-muted-foreground font-medium">Pas encore répondu :</span>{" "}
            {p.waiting.join(", ")}
          </li>
        )}
      </ul>

      {live && p.invited && !p.isMine && (
        <div className="grille-4-demi pt-1" role="group" aria-label="Ma réponse">
          <Button
            type="button"
            variant={p.myResponse === "yes" ? "default" : "outline"}
            aria-pressed={p.myResponse === "yes"}
            disabled={pending}
            onClick={() => onRespond(true)}
          >
            <Check />{" "}
            {p.myResponse === "yes" ? "Accepté" : series ? "Accepter la série" : "Accepter"}
          </Button>
          <Button
            type="button"
            variant={p.myResponse === "no" ? "secondary" : "outline"}
            aria-pressed={p.myResponse === "no"}
            disabled={pending}
            onClick={() => onRespond(false)}
          >
            <X />{" "}
            {p.myResponse === "no"
              ? "Refusé"
              : series && p.myResponse === "yes"
                ? "Quitter la série"
                : "Refuser"}
          </Button>
        </div>
      )}
      {live && !p.invited && (
        <p className="text-muted-foreground text-xs">
          Tu n&apos;es pas invité·e : tu vois ce plan parce que tu es dans le groupe.
        </p>
      )}
      {live && p.myResponse === "yes" && !p.isMine && (
        <p className="text-muted-foreground text-xs">
          {series
            ? "Chaque fois est dans ton horaire. « Quitter la série » la retire de ton horaire seulement."
            : "Ce moment est dans ton horaire."}
        </p>
      )}
      {going && series && (
        <p className="text-muted-foreground text-xs">
          « Ajouter à mon agenda » met toute la série dans le calendrier de ton téléphone, avec un
          rappel 30 min avant chaque fois.
        </p>
      )}
      {(going || (live && p.isMine)) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {going && (
            <Button asChild variant="outline" size="sm">
              <a href={`/plans/${p.id}/ics`} download>
                <CalendarPlus /> Ajouter à mon agenda
              </a>
            </Button>
          )}
          {(p.isMine || (series && going)) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={onCancel}
            >
              <X /> {series ? "Arrêter la série" : "Annuler le plan"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
