"use client";

import { useMemo, useState, useTransition } from "react";

import { AddressSearch } from "@/components/places/address-search";
import { type MapPoint, PlaceMapLazy } from "@/components/places/place-map-lazy";
import { TravelModePicker } from "@/components/travel-mode-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import { PLACE_NAME_MAX, roundCoord } from "@/lib/places/validation";
import type { TravelMode } from "@/lib/scheduling/types";

import { passerAccueil, terminerAccueil } from "./actions";

interface Choice {
  resultId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const ETAPES = ["Ta maison", "Ton cégep ou ton école", "Ton mode de transport"] as const;

function fromResult(r: GeocodeResult, name?: string): Choice {
  return { resultId: r.id, name: name ?? r.name, address: r.address, lat: r.lat, lng: r.lng };
}

/** Étape « lieu » : recherche, vérification sur la carte, nom. */
function PlaceStep({
  label,
  placeholder,
  value,
  onChange,
  defaultName,
}: {
  label: string;
  placeholder: string;
  value: Choice | null;
  onChange: (c: Choice) => void;
  defaultName?: string;
}) {
  const points = useMemo<MapPoint[]>(
    () =>
      value
        ? [{ id: "choix", lat: value.lat, lng: value.lng, label: value.name, highlighted: true }]
        : [],
    [value],
  );
  return (
    <div className="flex flex-col gap-4">
      <AddressSearch
        label={label}
        placeholder={placeholder}
        selectedId={value?.resultId ?? null}
        onSelect={(r) => onChange(fromResult(r, defaultName))}
      />
      <PlaceMapLazy
        points={points}
        onPick={
          value
            ? (lat, lng) => onChange({ ...value, lat: roundCoord(lat), lng: roundCoord(lng) })
            : undefined
        }
      />
      {value && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {value.address} — touche la carte pour ajuster le point.
          </p>
          <Label htmlFor="nom-lieu">Nom affiché</Label>
          <Input
            id="nom-lieu"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            maxLength={PLACE_NAME_MAX}
            required
          />
        </div>
      )}
    </div>
  );
}

export function OnboardingForm({ next, initialMode }: { next: string; initialMode: TravelMode }) {
  const [step, setStep] = useState(0);
  const [home, setHome] = useState<Choice | null>(null);
  const [school, setSchool] = useState<Choice | null>(null);
  const [mode, setMode] = useState<TravelMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await terminerAccueil(
        {
          home: home && { name: home.name, lat: home.lat, lng: home.lng },
          school: school && { name: school.name, lat: school.lat, lng: school.lng },
          travelMode: mode,
        },
        next,
      );
      if (!r.ok) setError(r.error);
    });
  }

  function skip() {
    setError(null);
    startTransition(async () => {
      const r = await passerAccueil(next);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Étape {step + 1} sur {ETAPES.length}
        </p>
        <CardTitle>{ETAPES[step]}</CardTitle>
        <CardDescription>
          {step === 0 && "D'où pars-tu le matin et où reviens-tu le soir ?"}
          {step === 1 && "Là où tu passes tes journées. Tu peux passer cette étape."}
          {step === 2 && "On s'en sert pour estimer tes temps de trajet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {step === 0 && (
          <PlaceStep
            label="Adresse de ta maison"
            placeholder="Ex. 945 chemin de Chambly, Longueuil"
            value={home}
            onChange={setHome}
            defaultName="Maison"
          />
        )}
        {step === 1 && (
          <PlaceStep
            label="Nom ou adresse de ton cégep ou école"
            placeholder="Ex. Cégep Édouard-Montpetit"
            value={school}
            onChange={setSchool}
          />
        )}
        {step === 2 && <TravelModePicker value={mode} onChange={setMode} />}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} disabled={pending}>
              Retour
            </Button>
          )}
          {step === 0 && (
            <Button onClick={() => setStep(1)} disabled={!home || !home.name.trim()}>
              Continuer
            </Button>
          )}
          {step === 1 && school && (
            <>
              <Button onClick={() => setStep(2)} disabled={!school.name.trim()}>
                Continuer
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSchool(null);
                  setStep(2);
                }}
              >
                Je n&apos;en ai pas
              </Button>
            </>
          )}
          {step === 1 && !school && (
            <Button variant="ghost" onClick={() => setStep(2)}>
              Passer cette étape
            </Button>
          )}
          {step === 2 && (
            <Button onClick={submit} disabled={pending || !home}>
              {pending ? "Enregistrement…" : "Terminer"}
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={skip}
          disabled={pending}
          className="text-muted-foreground self-start text-xs underline-offset-4 hover:underline"
        >
          Plus tard (je le ferai dans « Mes lieux »)
        </button>
      </CardContent>
    </Card>
  );
}
