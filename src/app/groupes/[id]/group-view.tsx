"use client";

import { EmptyState } from "@/components/empty-state";
import {
  CalendarCheck,
  Check,
  Copy,
  EyeOff,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Repeat,
  Share2,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { Avatar } from "@/components/avatar";
import { useConfirm } from "@/components/confirm-dialog";
import { type Flash, FlashMessage } from "@/components/flash-message";
import { PageSections } from "@/components/page-sections";
import { AddressSearch } from "@/components/places/address-search";
import { type MapPoint, PlaceMapLazy } from "@/components/places/place-map-lazy";
import { type PlanActions, PlanList } from "@/components/plans/plan-list";
import {
  type ProposeAction,
  ProposeDialog,
  type ProposeDraft,
} from "@/components/plans/propose-dialog";
import { FreeNow } from "@/components/free-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import type { GroupFavorite, GroupMember } from "@/lib/groups/queries";
import type { ProposalView } from "@/lib/meetups/search";
import { defaultFreeSlot, draftFromSlot } from "@/lib/plans/validation";
import type { PlanView } from "@/lib/plans/view";
import { PLACE_NAME_MAX, roundCoord } from "@/lib/places/validation";

import {
  ajouterFavori,
  quitterGroupe,
  regenererCode,
  retirerMembre,
  supprimerFavori,
} from "../actions";
import { annulerPlan, proposerMoment, repondrePlan } from "../../plans/actions";
import { MeetupFinder } from "./meetup-finder";
import type { ScheduleLine } from "./schedule-lines";
import { useI18n } from "@/lib/i18n/client";

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
  /** Plans à venir du groupe (`null` : illisibles, voir `plansError`). */
  plans: PlanView[] | null;
  plansError?: string | null;
  /** Actions des plans (remplaçables pour une page de démonstration). */
  planActions?: PlanActions;
  propose?: ProposeAction;
  search?: Parameters<typeof MeetupFinder>[0]["search"];
  /** Action « Je suis libre maintenant » (remplaçable pour une page de démonstration). */
  freeNowSearch?: Parameters<typeof FreeNow>[0]["search"];
}

const DEFAULT_PLAN_ACTIONS: PlanActions = { repondre: repondrePlan, annuler: annulerPlan };

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
  const { t, tr } = useI18n();
  const tg = t.groups;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Flash>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const { confirm, confirmDialog } = useConfirm();
  const [link, setLink] = useState(props.inviteLink);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [proposeDraft, setProposeDraft] = useState<ProposeDraft | null>(null);
  const [extraPlace, setExtraPlace] = useState<{ id: string; name: string } | null>(null);
  const planActions = props.planActions ?? DEFAULT_PLAN_ACTIONS;

  const placeOptions = useMemo(() => {
    const list = favorites.map((f) => ({ id: f.id, name: f.name }));
    if (extraPlace && !list.some((p) => p.id === extraPlace.id)) list.unshift(extraPlace);
    return list;
  }, [favorites, extraPlace]);

  function proposeFromSlot(p: ProposalView, participantIds: string[]) {
    const call = p.kind === "call";
    setExtraPlace(p.placeId && p.placeName ? { id: p.placeId, name: p.placeName } : null);
    const everyone = members.every((m) => participantIds.includes(m.userId));
    setProposeDraft({
      title: call ? tg.callTitle : t.plans.defaultTitle,
      ...draftFromSlot(p.start, p.durationMinutes),
      placeId: call ? null : p.placeId,
      location: call ? tg.callLocation : "",
      inviteeIds: everyone ? null : participantIds,
      fromSlot: `${p.dayLabel}, ${p.timeLabel}${call ? tg.callSuffix : p.placeName ? ` · ${p.placeName}` : ""}`,
    });
  }

  function proposeFree() {
    setExtraPlace(null);
    setProposeDraft({
      title: t.plans.defaultTitle,
      ...defaultFreeSlot(new Date()),
      durationMinutes: 120,
      placeId: favorites[0]?.id ?? null,
      location: "",
      inviteeIds: null,
    });
  }

  /** Story 5 : activité qui revient (ex. le gym tous les soirs), proposée une seule fois. */
  function proposeRecurring() {
    setExtraPlace(null);
    setProposeDraft({
      title: "",
      ...defaultFreeSlot(new Date()),
      durationMinutes: 90,
      placeId: favorites[0]?.id ?? null,
      location: "",
      inviteeIds: null,
      repeat: { unit: "day", every: 1, until: null },
    });
  }

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
      setMessage({ type: "erreur", text: tg.copyFailed });
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: name,
        text: tg.shareText(name),
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
      ? tg.leaveAlone
      : isAdmin && admins.length === 1
        ? tg.leaveNewAdmin(others[0].displayName)
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

  // Seul dans le groupe : inviter passe avant la recherche (impossible à deux de moins).
  const alone = members.length < 2;
  const invite = (
    <Card id="inviter" className="scroll-mt-32">
      <CardHeader>
        <CardTitle>{alone ? tg.inviteFirst : tg.inviteFriends}</CardTitle>
        <CardDescription>{tg.inviteBody}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Label htmlFor="lien-invitation" className="sr-only">
          {tg.inviteLink}
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
            {copied ? <Check /> : <Copy />} {copied ? tg.copied : tg.copy}
          </Button>
          {canShare && (
            <Button type="button" variant="outline" onClick={share}>
              <Share2 /> {tg.share}
            </Button>
          )}
          {isAdmin && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                if (
                  await confirm({ message: tg.confirmNewLink, action: tg.newLink, danger: false })
                ) {
                  setMessage(null);
                  startTransition(async () => {
                    const r = await regenererCode(groupId);
                    if (r.ok) {
                      setLink(link.replace(/[0-9a-f]{32}$/, r.code));
                      setMessage({
                        type: "ok",
                        text: tg.newLinkDone,
                      });
                    } else {
                      setMessage({ type: "erreur", text: r.error });
                    }
                  });
                }
              }}
            >
              <RefreshCw /> {tg.newLink}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="titre-page break-words">{name}</h1>
        <div className="flex items-center gap-3">
          {/* Les visages du groupe, empilés (5 au plus). */}
          <span aria-hidden className="flex -space-x-2">
            {members.slice(0, 5).map((m) => (
              <Avatar
                key={m.userId}
                name={m.displayName}
                className="ring-background size-8 ring-2"
              />
            ))}
          </span>
          <p className="text-muted-foreground text-sm">
            {tg.members(members.length)}
            {isAdmin ? tg.youAreAdmin : ""}
          </p>
        </div>
      </header>

      <PageSections
        items={[
          ...(alone
            ? [{ id: "inviter", label: tg.sections.invite }]
            : [
                { id: "propositions", label: tg.sections.plans },
                { id: "se-voir", label: tg.sections.find },
                { id: "inviter", label: tg.sections.invite },
              ]),
          { id: "membres", label: tg.sections.members },
          { id: "lieux-groupe", label: tg.sections.places },
          { id: "horaires", label: tg.sections.schedules },
        ]}
      />

      {alone ? (
        <>
          {invite}
          <EmptyState icon={UserPlus}>{tg.aloneHint}</EmptyState>
        </>
      ) : (
        <>
          <section aria-labelledby="propositions" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="propositions" className="titre-section scroll-mt-32">
                {tg.groupPlans}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={proposeFree}>
                  <Plus /> {tg.proposeMoment}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={proposeRecurring}>
                  <Repeat /> {tg.recurring}
                </Button>
              </div>
            </div>
            {props.plansError ? (
              <p
                role="alert"
                className="border-destructive/40 bg-destructive/8 text-destructive rounded-lg border p-3 text-sm"
              >
                {tr(props.plansError)}
              </p>
            ) : !props.plans || props.plans.length === 0 ? (
              <EmptyState icon={CalendarCheck}>{tg.noPlans}</EmptyState>
            ) : (
              <PlanList plans={props.plans} actions={planActions} />
            )}
            <Link href="/plans" className="text-sm underline underline-offset-2 sm:self-start">
              {tg.allMyPlans}
            </Link>
          </section>
          <FreeNow
            groupId={groupId}
            onPropose={(m) =>
              proposeFromSlot(
                {
                  key: `maintenant-${m.personId}`,
                  kind: m.kind,
                  placeId: m.placeId,
                  placeName: m.placeName,
                  start: m.start,
                  end: m.end,
                  dayLabel: m.dayLabel,
                  timeLabel: m.timeLabel,
                  durationMinutes: m.durationMinutes,
                  travel: [],
                  score: 0,
                },
                [myId, m.personId],
              )
            }
            {...(props.freeNowSearch ? { search: props.freeNowSearch } : {})}
          />
          <MeetupFinder
            groupId={groupId}
            myId={myId}
            members={members}
            onPropose={proposeFromSlot}
            {...(props.search ? { search: props.search } : {})}
          />
          {invite}
          <ProposeDialog
            draft={proposeDraft}
            groupId={groupId}
            myId={myId}
            members={members}
            places={placeOptions}
            propose={props.propose ?? proposerMoment}
            onClose={() => setProposeDraft(null)}
            onDone={(text) => {
              setProposeDraft(null);
              setMessage({ type: "ok", text });
              document.getElementById("propositions")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        </>
      )}

      <FlashMessage message={message} onClose={clearMessage} />
      {confirmDialog}
      <section aria-labelledby="membres" className="flex flex-col gap-3">
        <h2 id="membres" className="titre-section scroll-mt-32">
          {tg.membersTitle}
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.userId} className="rangee flex flex-wrap items-center gap-2 p-3">
              <Avatar name={m.displayName} />
              <span className="min-w-0 flex-1 font-semibold break-words">
                {m.displayName}
                {m.userId === myId && (
                  <span className="text-muted-foreground font-normal">{tg.you}</span>
                )}
              </span>
              {m.role === "admin" && <Badge variant="secondary">{tg.admin}</Badge>}
              {isAdmin && m.userId !== myId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      await confirm({ message: tg.confirmRemove(m.displayName), action: tg.remove })
                    ) {
                      run(() => retirerMembre(groupId, m.userId), tg.removed(m.displayName));
                    }
                  }}
                >
                  <UserMinus /> {tg.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="sm:self-start"
          disabled={pending}
          onClick={async () => {
            if (await confirm({ message: tg.confirmLeave(name, leaveWarning), action: tg.leave })) {
              run(
                () => quitterGroupe(groupId),
                tg.left,
                () => router.push("/groupes"),
              );
            }
          }}
        >
          <LogOut /> {tg.leave}
        </Button>
      </section>

      <section aria-labelledby="lieux-groupe" className="flex flex-col gap-3">
        <h2 id="lieux-groupe" className="titre-section scroll-mt-32">
          {tg.favoritesTitle}
        </h2>
        <p className="text-muted-foreground text-sm">{tg.favoritesHint}</p>
        <PlaceMapLazy
          points={points}
          onPick={
            draft
              ? (lat, lng) => setDraft({ ...draft, lat: roundCoord(lat), lng: roundCoord(lng) })
              : undefined
          }
        />
        {favorites.length === 0 ? (
          <p className="text-sm">{tg.noFavorites}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {favorites.map((f) => (
              <li key={f.id} className="rangee flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setFocusId(f.id)}
                  title={t.places.seeOnMap}
                >
                  <MapPin className="text-muted-foreground size-4 shrink-0" />
                  <span className="font-medium break-words">{f.name}</span>
                </button>
                {(isAdmin || f.ownerId === myId) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={async () => {
                      if (
                        await confirm({
                          message: tg.confirmDeleteFavorite(f.name),
                          action: t.common.delete,
                        })
                      ) {
                        run(() => supprimerFavori(groupId, f.id), t.places.deleted);
                      }
                    }}
                  >
                    <Trash2 /> {t.common.delete}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{tg.addFavorite}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <AddressSearch
              label={t.places.searchLabel}
              placeholder={tg.favoritePlaceholder}
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
                    tg.favoriteAdded(draft.name.trim()),
                    () => setDraft(null),
                  );
                }}
              >
                <p className="text-muted-foreground text-xs">
                  {draft.address} ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)})
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="nom-favori">{t.places.placeName}</Label>
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
                    {pending ? t.common.saving : tg.addToGroup}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                    {t.common.cancel}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="horaires" className="flex flex-col gap-3">
        <h2 id="horaires" className="titre-section scroll-mt-32">
          {tg.schedulesTitle}
        </h2>
        <p className="text-muted-foreground text-sm">
          {tg.schedulesBefore}
          <Link href="/profil" className="underline underline-offset-2">
            {tg.schedulesLink}
          </Link>
          .
        </p>
        {schedules.map((s) => (
          <details key={s.userId} className="rangee p-3" open={schedules.length <= 3}>
            <summary className="cursor-pointer font-semibold">
              {s.displayName}
              {s.userId === myId ? tg.you : ""}{" "}
              <span className="text-muted-foreground text-sm font-normal">
                · {s.lines.length === 0 ? tg.nothingEntered : tg.blocks(s.lines.length)}
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
                      {l.titleHidden && <EyeOff className="size-3.5" aria-label={tg.titleHidden} />}
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
