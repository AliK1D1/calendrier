"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/client";
import { OUTING_LIMIT_RANGE } from "@/lib/scheduling/outingLimits";

import { enregistrerLimiteSorties } from "./actions";

const SELECT =
  "border-input focus-visible:ring-ring/50 h-11 sm:h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

/** Choix de 1 à `max` (toujours avec la valeur actuelle). */
function choices(max: number, current: number | null): number[] {
  const list = Array.from({ length: max }, (_, i) => i + 1);
  if (current !== null && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** « Limite de sorties » : plans de groupe par jour et par semaine au plus. */
export function OutingLimitsForm({
  perDay,
  perWeek,
}: {
  perDay: number | null;
  perWeek: number | null;
}) {
  const { t, tr } = useI18n();
  const to = t.plans.outingLimit;
  const [day, setDay] = useState(perDay === null ? "" : String(perDay));
  const [week, setWeek] = useState(perWeek === null ? "" : String(perWeek));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const r = await enregistrerLimiteSorties({ perDay: day, perWeek: week });
          setMessage(r.ok ? { ok: true, text: to.saved } : { ok: false, text: tr(r.error) });
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sorties-jour">{to.perDay}</Label>
          <select
            id="sorties-jour"
            className={SELECT}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          >
            <option value="">{to.none}</option>
            {choices(OUTING_LIMIT_RANGE.perDay.max, perDay).map((n) => (
              <option key={n} value={n}>
                {to.count(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sorties-semaine">{to.perWeek}</Label>
          <select
            id="sorties-semaine"
            className={SELECT}
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          >
            <option value="">{to.none}</option>
            {choices(10, perWeek).map((n) => (
              <option key={n} value={n}>
                {to.count(n)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-success text-sm" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? t.common.saving : to.save}
      </Button>
    </form>
  );
}
