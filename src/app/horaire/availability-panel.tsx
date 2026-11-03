"use client";

import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions";
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
        setMessage({ ok: true, text: "Disponibilité ajoutée." });
      } else {
        setMessage({ ok: false, text: r.error });
      }
    });
  }

  function remove(itemId: string) {
    setMessage(null);
    startTransition(async () => {
      const r = await actions.supprimer(itemId);
      setMessage(
        r.ok ? { ok: true, text: "Disponibilité supprimée." } : { ok: false, text: r.error },
      );
    });
  }

  return (
    <section
      aria-labelledby={`${id}-titre`}
      className="bg-card flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-titre`} className="flex items-center gap-2 text-lg font-semibold">
          <CalendarCheck className="size-5" aria-hidden /> Disponibilités ponctuelles
        </h2>
        <p className="text-muted-foreground text-sm">
          « Ce samedi, je suis libre de 13 h à 18 h. » Ce jour-là, l&apos;app ne propose des moments
          que pendant ces heures, même si ton horaire habituel (cours, travail) dit autre chose. Les
          plans acceptés et les séances d&apos;étude de ce jour-là comptent toujours. Tes groupes
          voient le jour et les heures, jamais la note.
        </p>
      </div>

      {unavailable ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
          {unavailable}
        </p>
      ) : (
        <>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-jour`}>Jour</Label>
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
              <Label htmlFor={`${id}-de`}>De</Label>
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
              <Label htmlFor={`${id}-a`}>À</Label>
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
              <Label htmlFor={`${id}-note`}>Note pour toi (facultatif)</Label>
              <Input
                id={`${id}-note`}
                maxLength={MAX_AVAILABILITY_NOTE}
                placeholder="ex. pas de shift cette semaine"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending} className="min-h-10 self-end">
              <Plus /> Ajouter
            </Button>
          </form>

          {message && (
            <p
              role={message.ok ? "status" : "alert"}
              className={
                message.ok
                  ? "text-sm"
                  : "border-destructive/40 text-destructive rounded-md border p-3 text-sm"
              }
            >
              {message.text}
            </p>
          )}

          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune disponibilité à venir.</p>
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
                    aria-label={`Supprimer la disponibilité du ${item.dayLabel}, ${item.timeLabel}`}
                  >
                    <Trash2 /> Supprimer
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
