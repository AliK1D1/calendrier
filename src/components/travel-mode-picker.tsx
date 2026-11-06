"use client";

import { Bike, Bus, Car, Footprints } from "lucide-react";

import { useI18n } from "@/lib/i18n/client";
import type { TravelMode } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

const ICONS: Record<TravelMode, typeof Bus> = {
  transit: Bus,
  walk: Footprints,
  bike: Bike,
  car: Car,
};

/** Choix du mode de transport : quatre grosses cases, faciles à toucher sur un téléphone. */
export function TravelModePicker({
  value,
  onChange,
  name = "travel_mode",
}: {
  value: TravelMode;
  onChange: (mode: TravelMode) => void;
  name?: string;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t.common.travelModes.question}</legend>
      <div className="grille-4-demi">
        {(Object.keys(ICONS) as TravelMode[]).map((mode) => {
          const Icon = ICONS[mode];
          return (
            <label
              key={mode}
              className={cn(
                "bg-card hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2",
                value === mode && "border-primary bg-accent font-medium",
              )}
            >
              <input
                type="radio"
                name={name}
                value={mode}
                checked={value === mode}
                onChange={() => onChange(mode)}
                className="sr-only"
              />
              <Icon className="size-5 shrink-0" aria-hidden />
              {t.common.travelModes[mode]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
