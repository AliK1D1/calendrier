"use client";

import { Home, MapPin, Pencil, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";

import { useConfirm } from "@/components/confirm-dialog";
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

import { ajouterLieu, definirMaison, renommerLieu, supprimerLieu } from "./actions";
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
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
      label: p.id === homeId ? t.places.homeSuffix(p.name) : p.name,
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
  }, [places, homeId, draft, focusId, t]);

  return (
    <div className="flex flex-col gap-6">
      <FlashMessage message={message} onClose={clearMessage} />
      {confirmDialog}

      <PlaceMapLazy
        points={points}
        onPick={
          draft
            ? (lat, lng) => setDraft({ ...draft, lat: roundCoord(lat), lng: roundCoord(lng) })
            : undefined
        }
      />

      <section aria-labelledby="liste-lieux" className="flex flex-col gap-3">
        <h2 id="liste-lieux" className="titre-section">
          {places.length === 0 ? t.places.none : t.places.count(places.length)}
        </h2>
        <ul className="flex flex-col gap-2">
          {places.map((p) => (
            <li key={p.id} className="rangee p-3">
              {editingId === p.id ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => renommerLieu(p.id, editName), t.places.renamed);
                  }}
                >
                  <Label htmlFor={`nom-${p.id}`} className="sr-only">
                    {t.places.newName}
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
                      {t.common.save}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
                      {t.common.cancel}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setFocusId(p.id)}
                    title={t.places.seeOnMap}
                  >
                    <MapPin className="text-muted-foreground size-4 shrink-0" />
                    <span className="font-medium break-words">{p.name}</span>
                    {p.id === homeId && (
                      <Badge variant="secondary">
                        <Home /> {t.places.home}
                      </Badge>
                    )}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {p.id !== homeId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(() => definirMaison(p.id), t.places.isHome(p.name))}
                      >
                        <Home /> {t.places.setHome}
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
                      <Pencil /> {t.places.rename}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={async () => {
                        const yes = await confirm({
                          message: t.places.confirmDelete(p.name, p.id === homeId),
                          action: t.common.delete,
                        });
                        if (yes) {
                          run(() => supprimerLieu(p.id), t.places.deleted);
                        }
                      }}
                    >
                      <Trash2 /> {t.common.delete}
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
          <CardTitle>{t.places.addTitle}</CardTitle>
          <CardDescription>{t.places.addHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddressSearch
            label={t.places.searchLabel}
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
                  t.places.saved(draft.name.trim()),
                );
              }}
            >
              <p className="text-muted-foreground text-xs">
                {draft.address} ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)})
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="nouveau-nom">{t.places.placeName}</Label>
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
                {t.places.myHome}
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t.common.saving : t.places.savePlace}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  {t.common.cancel}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
