"use client";

import { Home, MapPin, Pencil, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";

import { type Flash, FlashMessage } from "@/components/flash-message";
import { AddressSearch } from "@/components/places/address-search";
import { type MapPoint, PlaceMapLazy } from "@/components/places/place-map-lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import { PLACE_NAME_MAX, roundCoord } from "@/lib/places/validation";
import type { MyPlace } from "@/lib/profile";
import { plural } from "@/lib/ux/plural";

import { ajouterLieu, definirMaison, renommerLieu, supprimerLieu } from "./actions";

interface Props {
  places: MyPlace[];
  homeId: string | null;
}

/** Brouillon du lieu en cours d'ajout : résultat choisi, éventuellement déplacé sur la carte. */
interface Draft {
  resultId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export function PlacesManager({ places, homeId }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Flash>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [asHome, setAsHome] = useState(homeId === null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setMessage(null);
    startTransition(async () => {
      const r = await action();
      setMessage(r.ok ? { type: "ok", text: ok } : { type: "erreur", text: r.error });
      if (r.ok) {
        setDraft(null);
        setEditingId(null);
        setAsHome(false);
      }
    });
  }

  function choose(r: GeocodeResult) {
    setDraft({ resultId: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng });
  }

  const points = useMemo<MapPoint[]>(() => {
    const list: MapPoint[] = places.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      label: p.id === homeId ? `${p.name} (maison)` : p.name,
      highlighted: !draft && p.id === focusId,
    }));
    if (draft) {
      list.push({
        id: "brouillon",
        lat: draft.lat,
        lng: draft.lng,
        label: draft.name,
        highlighted: true,
      });
    }
    return list;
  }, [places, homeId, draft, focusId]);

  return (
    <div className="flex flex-col gap-6">
      <FlashMessage message={message} onClose={clearMessage} />

      <PlaceMapLazy
        points={points}
        onPick={
          draft
            ? (lat, lng) => setDraft({ ...draft, lat: roundCoord(lat), lng: roundCoord(lng) })
            : undefined
        }
      />

      <section aria-labelledby="liste-lieux" className="flex flex-col gap-3">
        <h2 id="liste-lieux" className="text-lg font-semibold">
          {places.length === 0
            ? "Aucun lieu pour l'instant"
            : plural(places.length, "lieu", "lieux")}
        </h2>
        <ul className="flex flex-col gap-2">
          {places.map((p) => (
            <li key={p.id} className="bg-card rounded-lg border p-3">
              {editingId === p.id ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => renommerLieu(p.id, editName), "Lieu renommé.");
                  }}
                >
                  <Label htmlFor={`nom-${p.id}`} className="sr-only">
                    Nouveau nom
                  </Label>
                  <Input
                    id={`nom-${p.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={PLACE_NAME_MAX}
                    required
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={pending}>
                      Enregistrer
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
                      Annuler
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setFocusId(p.id)}
                    title="Voir sur la carte"
                  >
                    <MapPin className="text-muted-foreground size-4 shrink-0" />
                    <span className="font-medium break-words">{p.name}</span>
                    {p.id === homeId && (
                      <Badge variant="secondary">
                        <Home /> Maison
                      </Badge>
                    )}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {p.id !== homeId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => definirMaison(p.id), `« ${p.name} » est ta maison.`)
                        }
                      >
                        <Home /> Définir comme maison
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.name);
                      }}
                    >
                      <Pencil /> Renommer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const avertissement =
                          p.id === homeId ? " C'est ta maison : tu n'auras plus de maison." : "";
                        if (window.confirm(`Supprimer « ${p.name} » ?${avertissement}`)) {
                          run(() => supprimerLieu(p.id), "Lieu supprimé.");
                        }
                      }}
                    >
                      <Trash2 /> Supprimer
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter un lieu</CardTitle>
          <CardDescription>
            Cherche une adresse ou un nom (ex. « Cégep Édouard-Montpetit »), vérifie le point sur la
            carte (touche la carte pour le déplacer), puis enregistre.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddressSearch
            label="Adresse ou nom du lieu"
            selectedId={draft?.resultId ?? null}
            onSelect={choose}
          />
          {draft && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => ajouterLieu({ name: draft.name, lat: draft.lat, lng: draft.lng }, asHome),
                  `« ${draft.name.trim()} » est enregistré.`,
                );
              }}
            >
              <p className="text-muted-foreground text-xs">
                {draft.address} ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)})
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="nouveau-nom">Nom du lieu</Label>
                <Input
                  id="nouveau-nom"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={PLACE_NAME_MAX}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={asHome}
                  onChange={(e) => setAsHome(e.target.checked)}
                  className="size-4"
                />
                C&apos;est ma maison
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "Enregistrement…" : "Enregistrer ce lieu"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Annuler
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
