"use client";

import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions";
import { useI18n } from "@/lib/i18n/client";
import { MAX_AVAILABILITY_NOTE } from "@/lib/scheduling/oneOffAvailability";

/** Une de mes disponibilités, prête à afficher. */
export interface AvailabilityItem {
  id: string;
  /** « samedi 20 septembre » */
  dayLabel: string;
  /** « 13 h – 18 h » */
  timeLabel: string;
  note: string;
}

interface Props {
  items: AvailabilityItem[];
  /** Aujourd'hui et dernier jour permis (« yyyy-MM-dd »). */
  today: string;
  lastDay: string;
  /** Message si la base n'a pas encore la table (migration 0012). */
  unavailable?: string | null;
  actions: {
    ajouter: (input: unknown) => Promise<ActionResult>;
    supprimer: (id: unknown) => Promise<ActionResult>;
  };
}

/**
 * « Disponibilités ponctuelles » de /horaire : « ce samedi, je suis libre de 13 h à 18 h ».
 */
export function AvailabilityPanel({ items, today, lastDay, unavailable, actions }: Props) {
  const id = useId();
  const { t, tr } = useI18n();
  const ta = t.schedule.availability;
  const [day, setDay] = useState("");
  const [start, setStart] = useState("13:00");
  const [end, setEnd] = useState("18:00");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const r = await actions.ajouter({ day, start, end, note });
      if (r.ok) {
        setNote("");
        setMessage({ ok: true, text: ta.added });
      } else {
        setMessage({ ok: false, text: tr(r.error) });
      }
    });
  }

  function remove(itemId: string) {
    setMessage(null);
    startTransition(async () => {
      const r = await actions.supprimer(itemId);
      setMessage(r.ok ? { ok: true, text: ta.deleted } : { ok: false, text: tr(r.error) });
    });
  }

  return (
    <section aria-labelledby={`${id}-titre`} className="rangee flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-titre`} className="titre-section flex items-center gap-2">
          <CalendarCheck className="size-5" aria-hidden /> {ta.title}
        </h2>
        <p className="text-muted-foreground text-sm">{ta.intro}</p>
      </div>

      {unavailable ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          {unavailable}
        </p>
      ) : (
        <>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-jour`}>{ta.day}</Label>
              <Input
                id={`${id}-jour`}
                type="date"
                required
                min={today}
                max={lastDay}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-de`}>{ta.from}</Label>
              <Input
                id={`${id}-de`}
                type="time"
                step={900}
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-a`}>{ta.to}</Label>
              <Input
                id={`${id}-a`}
                type="time"
                step={900}
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${id}-note`}>{ta.note}</Label>
              <Input
                id={`${id}-note`}
                maxLength={MAX_AVAILABILITY_NOTE}
                placeholder={ta.notePlaceholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending} className="min-h-10 self-end">
              <Plus /> {ta.add}
            </Button>
          </form>

          {message && (
            <p
              role={message.ok ? "status" : "alert"}
              className={
                message.ok
                  ? "text-sm"
                  : "border-destructive/40 bg-destructive/8 text-destructive rounded-lg border p-3 text-sm"
              }
            >
              {message.text}
            </p>
          )}

          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{ta.none}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium first-letter:uppercase">
                      {item.dayLabel}, {item.timeLabel}
                    </span>
                    {item.note && (
                      <span className="text-muted-foreground text-xs break-words">{item.note}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                    aria-label={ta.removeLabel(item.dayLabel, item.timeLabel)}
                  >
                    <Trash2 /> {ta.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
