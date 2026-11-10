import { MapPin } from "lucide-react";

import { Avatar } from "@/components/avatar";
import type { Locale } from "@/lib/i18n/config";
import { formatClockLocale } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";

/** Journée montrée : de 8 h à 20 h. */
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
/** Blocs occupés de chaque personne (minutes depuis minuit), dans l'ordre de `demo.people`. */
const BUSY: [number, number][][] = [
  [
    [480, 600],
    [630, 750],
    [780, 900],
    [1080, 1200],
  ],
  [
    [540, 720],
    [780, 870],
    [1050, 1140],
  ],
  [
    [480, 600],
    [720, 870],
    [1020, 1200],
  ],
];
/** Le moment libre en commun : 15 h à 17 h. */
const FREE: [number, number] = [900, 1020];
const TICKS = [480, 720, 960, 1200];

const pct = (minute: number) => ((minute - DAY_START) / (DAY_END - DAY_START)) * 100;

/**
 * Illustration de l'accueil : trois horaires d'une même journée, et la bande où tout le monde
 * est libre. C'est l'idée de l'app montrée plutôt qu'expliquée ; les données sont fixes (rien
 * ne vient de la base). Les lecteurs d'écran reçoivent une phrase qui la résume.
 */
export function HomeDemo({ t, locale }: { t: Messages["home"]["demo"]; locale: Locale }) {
  const clock = (m: number) => formatClockLocale(m, locale);
  return (
    <figure className="bg-card shadow-carte m-0 flex flex-col gap-4 rounded-2xl border p-4 sm:p-6">
      <figcaption className="sr-only">
        {t.label} {t.day}, {clock(FREE[0])} – {clock(FREE[1])}, {t.place}. {t.travel}
      </figcaption>
      <div aria-hidden className="flex flex-col gap-2">
        <div className="flex items-end gap-3">
          <span className="font-display w-16 shrink-0 text-sm font-semibold sm:w-24">{t.day}</span>
          <div className="text-muted-foreground relative h-4 flex-1 text-[0.6875rem] tabular-nums">
            {TICKS.map((m, i) => (
              <span
                key={m}
                className="absolute whitespace-nowrap"
                style={i === TICKS.length - 1 ? { right: 0 } : { left: `${pct(m)}%` }}
              >
                {clock(m)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative flex flex-col gap-2">
          {t.people.map((person, i) => (
            <div key={person.name} className="flex items-center gap-3">
              <span className="flex w-16 shrink-0 items-center gap-2 text-sm font-medium sm:w-24">
                <Avatar name={person.name} className="size-7 text-[0.625rem] max-sm:hidden" />
                <span className="truncate">{person.name}</span>
              </span>
              <div className="bg-muted relative h-9 flex-1 overflow-hidden rounded-lg">
                {BUSY[i].map(([from, to], j) => (
                  <span
                    key={from}
                    className="bg-foreground/80 text-background absolute inset-y-1 flex items-center overflow-hidden rounded-md px-1.5 text-[0.6875rem] font-semibold whitespace-nowrap"
                    style={{ left: `${pct(from)}%`, width: `calc(${pct(to) - pct(from)}% - 2px)` }}
                  >
                    <span className="truncate max-sm:hidden">{person.blocks[j]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {/* La bande commune, par-dessus les trois lignes. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-19 sm:left-27">
            <div
              className="bande-commune border-success bg-success/20 absolute -inset-y-1 rounded-lg border-2"
              style={{ left: `${pct(FREE[0])}%`, width: `${pct(FREE[1]) - pct(FREE[0])}%` }}
            />
          </div>
        </div>
      </div>
      <div aria-hidden className="flex items-start gap-3 border-t pt-4">
        <span className="bg-success text-success-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
          <MapPin className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-display text-lg leading-tight font-semibold tracking-tight">
            {t.free} : {clock(FREE[0])} – {clock(FREE[1])}
          </p>
          <p className="text-sm">{t.place}</p>
          <p className="text-muted-foreground text-xs">{t.travel}</p>
        </div>
      </div>
    </figure>
  );
}
