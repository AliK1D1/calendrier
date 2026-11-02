"use client";

import {
  Check,
  Copy,
  EyeOff,
  LogOut,
  MapPin,
  RefreshCw,
  Share2,
  Trash2,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AddressSearch } from "@/components/places/address-search";
import { type MapPoint, PlaceMapLazy } from "@/components/places/place-map-lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import type { GroupFavorite, GroupMember } from "@/lib/groups/queries";
import { PLACE_NAME_MAX, roundCoord } from "@/lib/places/validation";

import {
  ajouterFavori,
  quitterGroupe,
  regenererCode,
  retirerMembre,
  supprimerFavori,
} from "../actions";
import { MeetupFinder } from "./meetup-finder";
import type { ScheduleLine } from "./schedule-lines";

export interface MemberSchedule {
  userId: string;
  displayName: string;
  lines: ScheduleLine[];
}

interface Props {
  groupId: string;
  name: string;
  inviteLink: string;
  myId: string;
  isAdmin: boolean;
  members: GroupMember[];
  favorites: GroupFavorite[];
  schedules: MemberSchedule[];
}

type Message = { type: "ok" | "erreur"; text: string } | null;
type Result = { ok: true } | { ok: false; error: string };

interface Draft {
  resultId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export function GroupView(props: Props) {
  const { groupId, name, myId, isAdmin, members, favorites, schedules } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  const [link, setLink] = useState(props.inviteLink);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  function run(action: () => Promise<Result>, ok: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const r = await action();
      setMessage(r.ok ? { type: "ok", text: ok } : { type: "erreur", text: r.error });
      if (r.ok) after?.();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (ex. page non sécurisée) : on sélectionne le lien à la place.
      const input = document.getElementById("lien-invitation");
      if (input instanceof HTMLInputElement) input.select();
      setMessage({ type: "erreur", text: "Copie impossible : sélectionne le lien et copie-le." });
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: name,
        text: `Rejoins « ${name} » sur Temps libre commun`,
        url: link,
      });
    } catch {
      // Partage annulé : rien à faire.
    }
  }

  const admins = members.filter((m) => m.role === "admin");
  const others = members.filter((m) => m.userId !== myId);
  const leaveWarning =
    others.length === 0
      ? " Tu es seul·e : le groupe et ses lieux seront supprimés."
      : isAdmin && admins.length === 1
        ? ` ${others[0].displayName} deviendra admin.`
        : "";

  const points = useMemo<MapPoint[]>(() => {
    const list: MapPoint[] = favorites.map((f) => ({
      id: f.id,
      lat: f.lat,
      lng: f.lng,
      label: f.name,
      highlighted: !draft && f.id === focusId,
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
  }, [favorites, draft, focusId]);

  // Bouton « Partager » seulement si le navigateur le permet (mobile surtout) ; décidé après
  // l'hydratation pour que le rendu serveur et le premier rendu client soient identiques.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight break-words">{name}</h1>
        <p className="text-muted-foreground text-sm">
          {members.length} membre{members.length > 1 ? "s" : ""}
          {isAdmin ? " · tu es admin" : ""}
        </p>
      </header>

      <MeetupFinder groupId={groupId} myId={myId} members={members} />

      {message && (
        <p
          role={message.type === "erreur" ? "alert" : "status"}
          className={
            message.type === "erreur"
              ? "border-destructive/40 text-destructive rounded-md border p-3 text-sm"
              : "rounded-md border border-emerald-500/40 p-3 text-sm"
          }
        >
          {message.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inviter des amis</CardTitle>
          <CardDescription>
            Envoie ce lien : la personne se connecte, puis confirme pour rejoindre le groupe. Sans
            le lien, personne ne peut voir ni rejoindre le groupe.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="lien-invitation" className="sr-only">
            Lien d&apos;invitation
          </Label>
          <Input
            id="lien-invitation"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? "Lien copié" : "Copier le lien"}
            </Button>
            {canShare && (
              <Button type="button" variant="outline" onClick={share}>
                <Share2 /> Partager
              </Button>
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Créer un nouveau lien ? L'ancien lien ne marchera plus (les membres actuels restent).",
                    )
                  ) {
                    setMessage(null);
                    startTransition(async () => {
                      const r = await regenererCode(groupId);
                      if (r.ok) {
                        setLink(link.replace(/[0-9a-f]{32}$/, r.code));
                        setMessage({
                          type: "ok",
                          text: "Nouveau lien créé. L'ancien ne marche plus.",
                        });
                      } else {
                        setMessage({ type: "erreur", text: r.error });
                      }
                    });
                  }
                }}
              >
                <RefreshCw /> Nouveau lien
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="membres" className="flex flex-col gap-3">
        <h2 id="membres" className="text-lg font-semibold">
          Membres
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="min-w-0 flex-1 font-medium break-words">
                {m.displayName}
                {m.userId === myId && (
                  <span className="text-muted-foreground font-normal"> (toi)</span>
                )}
              </span>
              {m.role === "admin" && <Badge variant="secondary">Admin</Badge>}
              {isAdmin && m.userId !== myId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Retirer ${m.displayName} du groupe ? Le lien d'invitation sera remplacé, pour qu'il ne puisse pas revenir avec l'ancien.`,
                      )
                    ) {
                      run(
                        () => retirerMembre(groupId, m.userId),
                        `${m.displayName} a été retiré·e. Le lien d'invitation a été remplacé.`,
                      );
                    }
                  }}
                >
                  <UserMinus /> Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="sm:self-start"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Quitter « ${name} » ?${leaveWarning}`)) {
              run(
                () => quitterGroupe(groupId),
                "Tu as quitté le groupe.",
                () => router.push("/groupes"),
              );
            }
          }}
        >
          <LogOut /> Quitter le groupe
        </Button>
      </section>

      <section aria-labelledby="lieux-groupe" className="flex flex-col gap-3">
        <h2 id="lieux-groupe" className="text-lg font-semibold">
          Lieux favoris du groupe
        </h2>
        <p className="text-muted-foreground text-sm">
          Cafés, parcs, bibliothèques… où vous aimez vous voir. Seuls les membres du groupe les
          voient.
        </p>
        <PlaceMapLazy
          points={points}
          onPick={
            draft
              ? (lat, lng) => setDraft({ ...draft, lat: roundCoord(lat), lng: roundCoord(lng) })
              : undefined
          }
        />
        {favorites.length === 0 ? (
          <p className="text-sm">Aucun lieu favori pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {favorites.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setFocusId(f.id)}
                  title="Voir sur la carte"
                >
                  <MapPin className="text-muted-foreground size-4 shrink-0" />
                  <span className="font-medium break-words">{f.name}</span>
                </button>
                {(isAdmin || f.ownerId === myId) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Supprimer « ${f.name} » des lieux du groupe ?`)) {
                        run(() => supprimerFavori(groupId, f.id), "Lieu supprimé.");
                      }
                    }}
                  >
                    <Trash2 /> Supprimer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un lieu au groupe</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <AddressSearch
              label="Adresse ou nom du lieu"
              placeholder="ex. Café Olimpico, parc La Fontaine"
              selectedId={draft?.resultId ?? null}
              onSelect={(r: GeocodeResult) =>
                setDraft({
                  resultId: r.id,
                  name: r.name,
                  address: r.address,
                  lat: r.lat,
                  lng: r.lng,
                })
              }
            />
            {draft && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    () =>
                      ajouterFavori(groupId, { name: draft.name, lat: draft.lat, lng: draft.lng }),
                    `« ${draft.name.trim()} » est ajouté au groupe.`,
                    () => setDraft(null),
                  );
                }}
              >
                <p className="text-muted-foreground text-xs">
                  {draft.address} ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)})
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="nom-favori">Nom du lieu</Label>
                  <Input
                    id="nom-favori"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    maxLength={PLACE_NAME_MAX}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Enregistrement…" : "Ajouter au groupe"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                    Annuler
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="horaires" className="flex flex-col gap-3">
        <h2 id="horaires" className="text-lg font-semibold">
          Quand chacun est occupé
        </h2>
        <p className="text-muted-foreground text-sm">
          Semaine type et blocs ponctuels des deux prochaines semaines. Par défaut, les autres
          voient « Occupé » et le lieu, pas le titre de tes cours :{" "}
          <Link href="/profil" className="underline underline-offset-2">
            régler dans mon profil
          </Link>
          .
        </p>
        {schedules.map((s) => (
          <details key={s.userId} className="rounded-lg border p-3" open={schedules.length <= 3}>
            <summary className="cursor-pointer font-medium">
              {s.displayName}
              {s.userId === myId ? " (toi)" : ""}{" "}
              <span className="text-muted-foreground text-sm font-normal">
                · {s.lines.length === 0 ? "rien d'entré" : `${s.lines.length} bloc(s)`}
              </span>
            </summary>
            {s.lines.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {s.lines.map((l) => (
                  <li key={l.key} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground w-44 shrink-0 tabular-nums">
                      {l.when}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {l.titleHidden && <EyeOff className="size-3.5" aria-label="Titre masqué" />}
                      {l.title}
                    </span>
                    {l.place && <span className="text-muted-foreground">· {l.place}</span>}
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}
