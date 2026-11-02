"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatClock, formatClockFr } from "@/lib/scheduling/weeklyBlocks";

import { enregistrerHeuresCalmes } from "./actions";

/** Choix proposés (toutes les 30 min) ; la valeur actuelle est ajoutée si elle n'y est pas. */
function options(from: number, to: number, current: number | null): number[] {
  const list: number[] = [];
  for (let m = from; m <= to; m += 30) list.push(m);
  if (current !== null && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

const SELECT =
  "border-input focus-visible:ring-ring/50 h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

/** « Heures où je ne sors pas » : avant telle heure, après telle heure. */
export function QuietHoursForm({ before, after }: { before: number | null; after: number | null }) {
  const [avant, setAvant] = useState(before === null ? "" : formatClock(before));
  const [apres, setApres] = useState(after === null ? "" : formatClock(after));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const r = await enregistrerHeuresCalmes({ before: avant, after: apres });
          setMessage(
            r.ok ? { ok: true, text: "Heures enregistrées." } : { ok: false, text: r.error },
          );
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="calme-avant">Je ne sors pas avant</Label>
          <select
            id="calme-avant"
            className={SELECT}
            value={avant}
            onChange={(e) => setAvant(e.target.value)}
          >
            <option value="">Pas de limite</option>
            {options(5 * 60, 12 * 60, before).map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockFr(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="calme-apres">Je ne sors pas après</Label>
          <select
            id="calme-apres"
            className={SELECT}
            value={apres}
            onChange={(e) => setApres(e.target.value)}
          >
            <option value="">Pas de limite</option>
            {options(17 * 60, 23 * 60 + 30, after).map((m) => (
              <option key={m} value={formatClock(m)}>
                {formatClockFr(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm text-emerald-700" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? "Enregistrement…" : "Enregistrer ces heures"}
      </Button>
    </form>
  );
}
