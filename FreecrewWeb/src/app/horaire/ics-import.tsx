"use client";

import { AlertTriangle, FileUp, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AddressSearch } from "@/components/places/address-search";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportedBlock, IcsPreview } from "@/lib/import/ics";
import { ICS_MAX_BYTES } from "@/lib/import/limits";
import type { IcsConfirmInput, PlaceChoice } from "@/lib/import/icsImport";
import { PLACE_NAME_MAX } from "@/lib/places/validation";
import type { Weekday } from "@/lib/scheduling/weeklyBlocks";
import { cn } from "@/lib/utils";

import type { IcsActions, SchedulePlace } from "./types";
import { useI18n } from "@/lib/i18n/client";
import { formatClockLocale, formatDay, weekdayLong } from "@/lib/i18n/format";

const SELECT =
  "border-input focus-visible:ring-ring/50 h-11 sm:h-10 w-full rounded-md border bg-transparent px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm";

/** Choix de lieu dans l'aperçu : « home », « place:<id> » ou « new » (+ recherche). */
type Pick =
  | { value: "home" }
  | { value: `place:${string}` }
  | { value: "new"; name: string; lat?: number; lng?: number; resultId?: string };

interface Props {
  places: SchedulePlace[];
  homeId: string | null;
  /** Lieu proposé quand aucun de mes lieux ne porte le nom lu dans le fichier. */
  defaultPlaceId: string | null;
  actions: IcsActions;
  onOpen?: () => void;
  onImported: (message: string) => void;
}

/** Bouton « Importer un horaire » (.ics, ou renvoi vers Outlook et les abonnements) + fenêtre d'aperçu et de confirmation. */
export function IcsImport(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Nouvelle clé à chaque ouverture : la fenêtre repart de zéro.
  const [session, setSession] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          props.onOpen?.();
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        <FileUp />
        <span>
          {t.schedule.ics.importShort}
          <span className="max-sm:hidden">{t.schedule.ics.importLong}</span>
        </span>
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="ics-titre"
        onClose={() => setOpen(false)}
        className="bg-popover text-popover-foreground shadow-flottant m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 sm:m-auto sm:max-w-2xl sm:rounded-2xl"
      >
        {open && (
          <ImportFlow
            key={session}
            {...props}
            onClose={() => setOpen(false)}
            onImported={(m) => {
              setOpen(false);
              props.onImported(m);
            }}
          />
        )}
      </dialog>
    </>
  );
}

function ImportFlow({
  places,
  homeId,
  defaultPlaceId,
  actions,
  onClose,
  onImported,
}: Props & { onClose: () => void }) {
  const { t, tr } = useI18n();
  const ti = t.schedule.ics;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IcsPreview | null>(null);
  const [existing, setExisting] = useState(0);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const homeName = places.find((p) => p.id === homeId)?.name ?? ti.home;

  function suggest(location: string): Pick {
    const l = location.toLocaleLowerCase("fr");
    const match = places.find((p) => {
      const n = p.name.toLocaleLowerCase("fr");
      return n === l || l.includes(n) || n.includes(l);
    });
    if (match) return { value: `place:${match.id}` };
    if (defaultPlaceId && places.some((p) => p.id === defaultPlaceId)) {
      return { value: `place:${defaultPlaceId}` };
    }
    return homeId ? { value: `place:${homeId}` } : { value: "home" };
  }

  function loadPreview() {
    setError(null);
    if (!file) {
      setError(ti.chooseFile);
      return;
    }
    if (file.size > ICS_MAX_BYTES) {
      setError(ti.tooBig);
      return;
    }
    const data = new FormData();
    data.set("fichier", file);
    startTransition(async () => {
      const r = await actions.apercuIcs(data);
      if (!r.ok) {
        setError(tr(r.error));
        return;
      }
      setPreview(r.preview);
      setExisting(r.existingIcs);
      setExcluded(new Set());
      setPicks(Object.fromEntries(r.preview.locations.map((l) => [l, suggest(l)])));
    });
  }

  const kept = useMemo(
    () => preview?.blocks.filter((b) => !excluded.has(b.key)) ?? [],
    [preview, excluded],
  );
  const usedLocations = useMemo(
    () => new Set(kept.map((b) => b.locationText).filter(Boolean)),
    [kept],
  );
  const missingPosition = [...usedLocations].filter((l) => {
    const p = picks[l];
    return p?.value === "new" && (p.lat === undefined || !p.name.trim());
  });

  function confirm() {
    if (!preview) return;
    setError(null);
    if (kept.length === 0) {
      setError(ti.checkOne);
      return;
    }
    if (missingPosition.length > 0) {
      setError(ti.searchAddress(missingPosition[0]));
      return;
    }
    const input: IcsConfirmInput = {
      blocks: kept.map((b) => ({
        title: b.title,
        startMinute: b.startMinute,
        endMinute: b.endMinute,
        weekday: b.weekday,
        validFrom: b.validFrom,
        validUntil: b.validUntil,
        locationText: b.locationText,
      })),
      places: [...usedLocations].map((l) => ({ locationText: l, choice: toChoice(picks[l]) })),
    };
    startTransition(async () => {
      const r = await actions.confirmerIcs(input);
      if (!r.ok) {
        setError(tr(r.error));
        return;
      }
      const parts = [ti.imported(r.imported)];
      if (r.replaced > 0) {
        parts.push(ti.replaced(r.replaced));
      }
      if (r.placesCreated > 0) {
        parts.push(ti.placesCreated(r.placesCreated));
      }
      onImported(ti.done(parts.join(", ")));
    });
  }

  const weekly = preview?.blocks.filter((b) => b.weekday != null) ?? [];
  const once = preview?.blocks.filter((b) => b.weekday == null) ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ics-titre" className="titre-section">
          {ti.title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t.common.close}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      {!preview ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2 text-sm">
            <li className="rounded-lg border p-3">
              <strong>{ti.outlookQ}</strong>{" "}
              <Link href="/profil#outlook" className="underline underline-offset-2">
                {ti.outlookLink}
              </Link>
              {ti.outlookAfter}
            </li>
            <li className="rounded-lg border p-3">
              <strong>{ti.linkQ}</strong>
              {ti.linkHint}{" "}
              <Link href="/profil#abonnements" className="underline underline-offset-2">
                {ti.linkLink}
              </Link>
              {ti.linkAfter}
            </li>
            <li className="border-primary bg-primary/5 rounded-lg border p-3">
              <strong>{ti.fileQ}</strong>
              {ti.fileHint}
            </li>
          </ul>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ics-fichier">{ti.fileLabel}</Label>
            {/*
              Le bouton natif dit « Choose File / No file chosen » (langue du navigateur) : on
              le cache visuellement et on montre un bouton et un texte en français. Le champ
              reste au clavier et au lecteur d'écran.
            */}
            <div className="flex min-w-0 items-center gap-3">
              <label
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-[3px]",
                )}
              >
                <FileUp aria-hidden />
                {ti.pickFile}
                <input
                  id="ics-fichier"
                  type="file"
                  accept=".ics,text/calendar"
                  className="sr-only"
                  onChange={(e) => {
                    setError(null);
                    setFile(e.target.files?.[0] ?? null);
                  }}
                />
              </label>
              <span
                className={cn("truncate text-sm", !file && "text-muted-foreground")}
                aria-live="polite"
              >
                {file ? file.name : ti.noFile}
              </span>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {tr(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={loadPreview} disabled={pending || !file}>
              {pending ? ti.reading : ti.seePreview}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm" role="status">
            {ti.detected(preview.blocks.length, weekly.length, once.length)}
          </p>

          {(preview.warnings.length > 0 || existing > 0) && (
            <div className="border-warning/60 bg-warning/15 flex gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <ul className="flex flex-col gap-1">
                {existing > 0 && <li>{ti.willReplace(existing)}</li>}
                {preview.warnings.map((w) => (
                  <li key={w}>{tr(w)}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.locations.length > 0 && (
            <section aria-labelledby="ics-lieux" className="flex flex-col gap-3">
              <h3 id="ics-lieux" className="font-semibold">
                {ti.fileLocations}
              </h3>
              <p className="text-muted-foreground -mt-2 text-xs">{ti.matchHint}</p>
              {preview.locations.map((loc, i) => {
                const pick = picks[loc] ?? { value: "home" };
                return (
                  <div
                    key={loc}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border p-3",
                      !usedLocations.has(loc) && "opacity-60",
                    )}
                  >
                    <Label htmlFor={`ics-lieu-${i}`} className="break-words">
                      <MapPin className="size-4 shrink-0" /> {loc}
                    </Label>
                    <select
                      id={`ics-lieu-${i}`}
                      className={SELECT}
                      value={pick.value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPicks((prev) => ({
                          ...prev,
                          [loc]:
                            v === "new"
                              ? { value: "new", name: loc.slice(0, PLACE_NAME_MAX) }
                              : v === "home"
                                ? { value: "home" }
                                : { value: v as `place:${string}` },
                        }));
                      }}
                    >
                      {places.map((p) => (
                        <option key={p.id} value={`place:${p.id}`}>
                          {p.name}
                          {p.id === homeId ? ti.homeSuffix : ""}
                        </option>
                      ))}
                      {!homeId && <option value="home">{homeName}</option>}
                      <option value="new">{ti.newPlace}</option>
                    </select>
                    {pick.value === "new" && (
                      <NewPlace
                        index={i}
                        location={loc}
                        pick={pick}
                        onChange={(p) => setPicks((prev) => ({ ...prev, [loc]: p }))}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <section aria-labelledby="ics-blocs" className="flex flex-col gap-2">
            <h3 id="ics-blocs" className="font-semibold">
              {ti.toImport(kept.length, preview.blocks.length)}
            </h3>
            <ul className="flex flex-col gap-2">
              {preview.blocks.map((b) => (
                <PreviewRow
                  key={b.key}
                  block={b}
                  checked={!excluded.has(b.key)}
                  onToggle={(on) =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(b.key);
                      else next.add(b.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </section>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {tr(error)}
            </p>
          )}
          <div className="bg-background sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t px-4 py-3 sm:-mx-6 sm:px-6">
            <Button type="button" onClick={confirm} disabled={pending || kept.length === 0}>
              {pending ? ti.importing : ti.importN(kept.length)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
              disabled={pending}
            >
              {ti.otherFile}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function toChoice(pick: Pick | undefined): PlaceChoice {
  if (!pick || pick.value === "home") return { kind: "home" };
  if (pick.value === "new") {
    return { kind: "new", name: pick.name.trim(), lat: pick.lat ?? NaN, lng: pick.lng ?? NaN };
  }
  return { kind: "place", id: pick.value.slice("place:".length) };
}

function NewPlace({
  index,
  location,
  pick,
  onChange,
}: {
  index: number;
  location: string;
  pick: Extract<Pick, { value: "new" }>;
  onChange: (p: Pick) => void;
}) {
  const { t } = useI18n();
  const ti = t.schedule.ics;
  return (
    <div className="flex flex-col gap-3 border-l-2 pl-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`ics-nom-${index}`}>{ti.newPlaceName}</Label>
        <Input
          id={`ics-nom-${index}`}
          value={pick.name}
          maxLength={PLACE_NAME_MAX}
          onChange={(e) => onChange({ ...pick, name: e.target.value })}
        />
      </div>
      <AddressSearch
        label={ti.address}
        initialQuery={location.slice(0, 200)}
        selectedId={pick.resultId ?? null}
        onSelect={(r) => onChange({ ...pick, lat: r.lat, lng: r.lng, resultId: r.id })}
      />
      {pick.lat === undefined && (
        <p className="text-muted-foreground text-xs">{ti.searchToPlace}</p>
      )}
    </div>
  );
}

function PreviewRow({
  block,
  checked,
  onToggle,
}: {
  block: ImportedBlock;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const ti = t.schedule.ics;
  const hours = ti.hours(
    formatClockLocale(block.startMinute, locale),
    formatClockLocale(block.endMinute, locale),
  );
  const when =
    block.weekday == null
      ? `${formatDay(block.validFrom, "weekdayDayMonthYear", locale)}, ${hours}`
      : ti.every(weekdayLong(block.weekday as Weekday, locale), hours);
  const period =
    block.weekday == null
      ? null
      : ti.period(
          formatDay(block.validFrom, "shortDayMonth", locale),
          formatDay(block.validUntil, "shortDayMonthYear", locale),
          block.occurrences,
        );
  const id = `ics-bloc-${block.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <li className={cn("flex items-start gap-3 rounded-lg border p-3", !checked && "opacity-60")}>
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-5 shrink-0"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="font-medium break-words">
          {block.title}
          {block.titleTruncated && (
            <Badge variant="secondary" className="ml-2">
              {ti.truncated}
            </Badge>
          )}
        </span>
        <span>{when}</span>
        {period && <span className="text-muted-foreground text-xs">{period}</span>}
        {block.locationText && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs break-words">
            <MapPin className="size-3 shrink-0" /> {block.locationText}
          </span>
        )}
      </label>
    </li>
  );
}
