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
import { formatInstantDay } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

const MODE_ICON = { walk: Footprints, bike: Bike, transit: Bus, car: Car } as const;

/** Story 6 : quand partir de mon lieu d'avant (seulement pour moi). */
function LeaveBy({ leaveBy: l }: { leaveBy: LeaveByView }) {
  const { t } = useI18n();
  const Icon = MODE_ICON[l.mode];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm max-sm:-ml-[3.75rem]",
        l.warning ? "border-warning/70 bg-warning/10" : "bg-accent/50 border-transparent",
      )}
      aria-label={t.plans.leaveBy}
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
        {l.note && <p className="text-muted-foreground text-xs max-sm:-ml-[3.75rem]">{l.note}</p>}
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

function status(p: PlanView, t: Messages["plans"]["status"]): { label: string; className: string } {
  const series = p.repeatLabel !== null;
  if (p.state === "cancelled")
    return {
      label: series ? t.seriesStopped : t.cancelled,
      className: "bg-muted text-muted-foreground",
    };
  if (p.state === "past")
    return {
      label: series ? t.seriesOver : t.past,
      className: "bg-muted text-muted-foreground",
    };
  if (p.isMine) return { label: t.mine, className: "bg-primary/10 text-primary" };
  if (!p.invited) return { label: t.info, className: "bg-muted text-muted-foreground" };
  if (p.myResponse === "yes") return { label: t.accepted, className: "bg-success/15 text-success" };
  if (p.myResponse === "no")
    return { label: t.declined, className: "bg-muted text-muted-foreground" };
  return { label: t.yourTurn, className: "bg-warning/20 text-foreground" };
}

/**
 * Le jour du plan en gros, comme une page de calendrier : on repère la date avant de lire le
 * reste. La couleur suit l'état (à répondre : ambre ; passé ou annulé : gris).
 */
function DateTile({ plan: p, awaiting }: { plan: PlanView; awaiting: boolean }) {
  const { locale } = useI18n();
  const at = new Date(p.startsAt);
  if (Number.isNaN(at.getTime())) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 self-start rounded-xl py-2 text-center leading-none sm:w-14",
        p.state !== "upcoming"
          ? "bg-muted text-muted-foreground"
          : awaiting
            ? "bg-warning/25 text-foreground"
            : "bg-accent text-accent-foreground",
      )}
    >
      <span className="text-[0.6875rem] font-semibold">
        {formatInstantDay(at, "shortWeekday", locale)}
      </span>
      <span className="font-display text-2xl font-bold tabular-nums">
        {formatInstantDay(at, "dayNumber", locale)}
      </span>
      <span className="text-[0.6875rem] font-semibold">
        {formatInstantDay(at, "shortMonth", locale)}
      </span>
    </div>
  );
}

/** Carte d'un plan : quand, où, qui vient, et mes boutons (accepter, refuser, annuler…). */
export function PlanCard({ plan: p, pending, onRespond, onCancel, showGroup }: Props) {
  const { t } = useI18n();
  const tp = t.plans;
  const s = status(p, tp.status);
  const live = p.state === "upcoming";
  const awaiting = live && p.invited && !p.isMine && p.myResponse === null;
  const going = live && (p.myResponse === "yes" || p.isMine);
  const series = p.repeatLabel !== null;
  return (
    <li
      className={cn(
        "rangee flex gap-3 p-3 sm:gap-4 sm:p-4",
        awaiting && "border-warning ring-warning/25 ring-3",
        !live && "opacity-75 shadow-none",
      )}
    >
      <DateTile plan={p} awaiting={awaiting} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "font-display text-lg leading-tight font-semibold tracking-tight break-words",
              p.state === "cancelled" && "line-through",
            )}
          >
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
            {p.repeatLabel && live ? tp.nextTime(p.dayLabel) : p.dayLabel}
          </span>
          <span className="tabular-nums">· {p.timeLabel}</span>
        </p>
        <p className="flex items-center gap-2 text-sm">
          <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="break-words">{p.where}</span>
        </p>
        {live && p.review && (
          <div
            className="border-warning/70 bg-warning/10 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm max-sm:-ml-[3.75rem]"
            role="note"
            aria-label={tp.reviewLabel}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-semibold">{tp.reviewBadge}</p>
              {p.review.mine && <p className="break-words">{p.review.mine}</p>}
              {p.review.others && <p className="break-words">{p.review.others}</p>}
              <p className="text-muted-foreground text-xs">{tp.reviewHint}</p>
            </div>
          </div>
        )}
        {live && p.leaveBy && <LeaveBy leaveBy={p.leaveBy} />}
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {tp.proposedBy} {p.isMine ? tp.you : p.creatorName}
            {showGroup && (
              <>
                {" "}
                {tp.inGroup}{" "}
                <Link href={`/groupes/${p.groupId}`} className="underline underline-offset-2">
                  {p.groupName}
                </Link>
              </>
            )}
            {" · "}
            {p.wholeGroup
              ? tp.wholeGroup
              : tp.invitedCount(p.accepted.length + p.declined.length + p.waiting.length)}
          </span>
        </p>
        <ul className="flex flex-col gap-0.5 text-sm" aria-label={tp.responses}>
          {p.accepted.length > 0 && (
            <li>
              <span className="text-success font-medium">{tp.yes}</span> {p.accepted.join(", ")}
            </li>
          )}
          {p.declined.length > 0 && (
            <li>
              <span className="text-muted-foreground font-medium">{tp.no}</span>{" "}
              {p.declined.join(", ")}
            </li>
          )}
          {p.waiting.length > 0 && live && (
            <li>
              <span className="text-muted-foreground font-medium">{tp.notYet}</span>{" "}
              {p.waiting.join(", ")}
            </li>
          )}
        </ul>

        {live && p.invited && !p.isMine && (
          <div
            className="grille-4-demi pt-1 max-sm:-ml-[3.75rem]"
            role="group"
            aria-label={tp.myAnswer}
          >
            <Button
              type="button"
              variant={p.myResponse === "no" ? "outline" : "default"}
              className={cn(
                p.myResponse === "yes" &&
                  "border-success/40 bg-success/15 text-success hover:bg-success/20 active:bg-success/25 border shadow-none",
              )}
              aria-pressed={p.myResponse === "yes"}
              disabled={pending}
              onClick={() => onRespond(true)}
            >
              <Check />{" "}
              {p.myResponse === "yes" ? tp.status.accepted : series ? tp.acceptSeries : tp.accept}
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
                ? tp.status.declined
                : series && p.myResponse === "yes"
                  ? tp.leaveSeries
                  : tp.decline}
            </Button>
          </div>
        )}
        {live && !p.invited && (
          <p className="text-muted-foreground text-xs max-sm:-ml-[3.75rem]">{tp.notInvited}</p>
        )}
        {live && p.myResponse === "yes" && !p.isMine && (
          <p className="text-muted-foreground text-xs max-sm:-ml-[3.75rem]">
            {series ? tp.inScheduleSeries : tp.inSchedule}
          </p>
        )}
        {going && series && (
          <p className="text-muted-foreground text-xs max-sm:-ml-[3.75rem]">
            {tp.calendarSeriesHint}
          </p>
        )}
        {(going || (live && p.isMine)) && (
          <div className="flex flex-wrap gap-2 pt-1 max-sm:-ml-[3.75rem]">
            {going && (
              <Button asChild variant="outline" size="sm">
                <a href={`/plans/${p.id}/ics`} download>
                  <CalendarPlus /> {tp.addToCalendar}
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
                <X /> {series ? tp.stopSeries : tp.cancelPlan}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
