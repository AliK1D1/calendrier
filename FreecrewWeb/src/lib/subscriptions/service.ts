/**
 * Calendriers en ligne abonnés (story 3) : ajout, synchronisation, « compte comme occupé »,
 * retrait. Aucun accès BD direct ici : tout passe par un `SubscriptionStore` injecté (Supabase
 * dans l'app, faux magasin dans les tests) ; le téléchargement et Outlook sont injectés aussi.
 *
 * Choix (story 3) :
 * - formats : lien iCalendar (.ics) en `https://`, `http://` ou `webcal://` ; ou un calendrier
 *   du compte Outlook connecté (les calendriers abonnés dans Outlook y apparaissent) ;
 * - synchro : aux 6 h quand l'app est ouverte, et par le bouton « Actualiser » ;
 * - lien brisé : on **garde la dernière version connue** et on avertit la personne ;
 * - pas de valeur par défaut pour « compte comme occupé » : la personne choisit à l'ajout ;
 * - les autres ne voient jamais le calendrier ; s'il compte comme occupé, ils voient
 *   seulement « Occupé » à ces heures.
 */
import { parseIcs } from "@/lib/import/ics";
import {
  outlookEventsToDayPieces,
  rangeInstants,
  type ExternalBusyEvent,
} from "@/lib/scheduling/outlookBusy";
import {
  cleanName,
  icsBlocksToRows,
  icsCalendarName,
  piecesToRows,
  SUBSCRIPTION_AUTO_SYNC_MINUTES,
  SUBSCRIPTION_MANUAL_SYNC_MINUTES,
  SUBSCRIPTION_MAX_EVENTS,
  subscriptionRange,
  type SubscriptionEventRow,
} from "@/lib/scheduling/subscriptions";
import { daysBetween } from "@/lib/scheduling/weeklyBlocks";

import { OutlookError } from "@/lib/outlook/oauth";

import { FeedError } from "./safeFetch";
import { normalizeSubscriptionUrl } from "./url";

/** Erreur montrée telle quelle à la personne (en français). */
export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

/** Abonnement à synchroniser (réservé par `claim`). */
export type ClaimedSubscription =
  | { id: string; kind: "ics"; url: string }
  | { id: string; kind: "outlook"; outlookCalendarId: string };

export interface NewSubscription {
  kind: "ics" | "outlook";
  name: string;
  url: string | null;
  outlookCalendarId: string | null;
  countsAsBusy: boolean;
}

/** Accès à la BD, au nom de la personne connectée (RLS). */
export interface SubscriptionStore {
  /** Réserve les abonnements dus (`id` : seulement celui-là). */
  claim(minMinutes: number, id: string | null): Promise<ClaimedSubscription[]>;
  /** Crée l'abonnement ; renvoie son identifiant. */
  insert(sub: NewSubscription): Promise<string>;
  /** Remplace les événements (une transaction) et note la synchro réussie. */
  replaceEvents(id: string, rows: SubscriptionEventRow[]): Promise<number>;
  /** Note l'échec ; la dernière version connue reste. */
  failSync(id: string, message: string): Promise<void>;
  setBusy(id: string, busy: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  /** Calendriers Outlook déjà abonnés (identifiants). */
  outlookCalendarIds(): Promise<string[]>;
}

/** Lecture d'un calendrier du compte Outlook connecté. */
export interface OutlookSource {
  /** Événements (y compris « Disponible ») du calendrier entre deux instants. */
  events(
    calendarId: string,
    range: { start: Date; end: Date },
  ): Promise<{ events: ExternalBusyEvent[]; truncated: boolean }>;
  /** Calendriers du compte. */
  calendars(): Promise<{ id: string; name: string; isDefault: boolean; readOnly: boolean }[]>;
  /** Calendrier déjà lu par le connecteur Outlook (`null` : le principal). */
  syncedCalendarId(): Promise<string | null>;
}

export interface SubscriptionDeps {
  store: SubscriptionStore;
  /** Télécharge un lien (déjà vérifié) ; lève une erreur au message en français. */
  fetchText: (url: string) => Promise<string>;
  /** Outlook connecté et configuré, sinon `null`. */
  outlook: OutlookSource | null;
  userId: string;
  now: () => Date;
  /** Limite par personne des téléchargements (absente : aucune limite, tests). */
  limiter?: { tryAcquire(key: string): boolean };
}

/** Téléchargements par minute et par personne (le serveur de l'app n'est pas un robot). */
export const SUBSCRIPTION_FETCHES_PER_MINUTE = 20;

const GENERIC = "La synchronisation de ce calendrier n'a pas fonctionné. Réessaie plus tard.";

function messageOf(e: unknown): string {
  // Messages déjà écrits pour la personne (en français).
  if (e instanceof SubscriptionError || e instanceof FeedError || e instanceof OutlookError) {
    return e.message.slice(0, 300);
  }
  console.error("Calendrier abonné :", e instanceof Error ? e.message : e);
  return GENERIC;
}

function today(deps: SubscriptionDeps) {
  return subscriptionRange(deps.now());
}

/** Fichier iCalendar → lignes de la fenêtre (et le nom du calendrier écrit dans le fichier). */
export function readIcsFeed(
  text: string,
  now: Date,
): { ok: true; rows: SubscriptionEventRow[]; name: string } | { ok: false; error: string } {
  const range = subscriptionRange(now);
  const parsed = parseIcs(text, {
    today: range.from,
    horizonDays: daysBetween(range.from, range.to) + 1,
    includeTransparent: true,
  });
  if (!parsed.ok) {
    // Un calendrier vide (rien de prévu) n'est pas une erreur.
    if (/Aucun événement/.test(parsed.error) && /BEGIN:VCALENDAR/i.test(text)) {
      return { ok: true, rows: [], name: icsCalendarName(text) };
    }
    return { ok: false, error: parsed.error.replace(/ce fichier|le fichier/gi, "ce calendrier") };
  }
  const rows = icsBlocksToRows(parsed.value.blocks, range);
  if (rows.length > SUBSCRIPTION_MAX_EVENTS) {
    return {
      ok: false,
      error: `Ce calendrier a trop d'événements (au plus ${SUBSCRIPTION_MAX_EVENTS} sur 8 semaines).`,
    };
  }
  return { ok: true, rows, name: icsCalendarName(text) };
}

/** Télécharge et lit un lien iCalendar (avec la limite par personne). */
async function pullIcs(deps: SubscriptionDeps, url: string) {
  if (deps.limiter && !deps.limiter.tryAcquire(deps.userId)) {
    throw new SubscriptionError("Trop de calendriers actualisés d'un coup. Attends une minute.");
  }
  const text = await deps.fetchText(url);
  const r = readIcsFeed(text, deps.now());
  if (!r.ok) throw new SubscriptionError(r.error);
  return r;
}

/** Lit un calendrier Outlook (événements au nom du calendrier, jamais les titres). */
async function pullOutlook(deps: SubscriptionDeps, calendarId: string, name: string) {
  if (!deps.outlook) {
    throw new SubscriptionError("Outlook n'est plus connecté. Reconnecte Outlook dans Profil.");
  }
  const range = today(deps);
  const { events } = await deps.outlook.events(calendarId, rangeInstants(range));
  const { pieces } = outlookEventsToDayPieces(events, range, {
    maxBlocks: SUBSCRIPTION_MAX_EVENTS,
  });
  return piecesToRows(pieces, name);
}

export type AddResult = { ok: true; id: string; events: number } | { ok: false; error: string };

/**
 * Ajoute un calendrier par son lien : on le télécharge et on le lit **avant** de l'enregistrer
 * (un lien qui ne marche pas n'est pas ajouté), puis on enregistre ses événements.
 */
export async function addIcsSubscription(
  deps: SubscriptionDeps,
  input: { url: string; name: string; countsAsBusy: boolean },
): Promise<AddResult> {
  const checked = normalizeSubscriptionUrl(input.url);
  if (!checked.ok) return checked;
  let feed: { rows: SubscriptionEventRow[]; name: string };
  try {
    feed = await pullIcs(deps, checked.url);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  const name = cleanName(input.name, "") || feed.name || checked.host;
  return save(deps, {
    sub: {
      kind: "ics",
      name,
      url: checked.url,
      outlookCalendarId: null,
      countsAsBusy: input.countsAsBusy,
    },
    rows: feed.rows,
  });
}

/** Ajoute un calendrier du compte Outlook connecté (vérifié auprès d'Outlook). */
export async function addOutlookSubscription(
  deps: SubscriptionDeps,
  input: { calendarId: string; countsAsBusy: boolean },
): Promise<AddResult> {
  if (!deps.outlook) return { ok: false, error: "Connecte d'abord Outlook (plus haut)." };
  let rows: SubscriptionEventRow[];
  let name: string;
  try {
    const found = (await deps.outlook.calendars()).find((c) => c.id === input.calendarId);
    if (!found) return { ok: false, error: "Calendrier introuvable dans ton compte Outlook." };
    name = cleanName(found.name, "Calendrier Outlook");
    rows = await pullOutlook(deps, found.id, name);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  return save(deps, {
    sub: {
      kind: "outlook",
      name,
      url: null,
      outlookCalendarId: input.calendarId,
      countsAsBusy: input.countsAsBusy,
    },
    rows,
  });
}

async function save(
  deps: SubscriptionDeps,
  { sub, rows }: { sub: NewSubscription; rows: SubscriptionEventRow[] },
): Promise<AddResult> {
  let id: string;
  try {
    id = await deps.store.insert(sub);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  try {
    const events = await deps.store.replaceEvents(id, rows);
    return { ok: true, id, events };
  } catch (e) {
    // Ex. limite de 1000 blocs : on n'ajoute pas un calendrier à moitié.
    await deps.store.remove(id).catch(() => undefined);
    return { ok: false, error: messageOf(e) };
  }
}

export interface SyncSummary {
  synced: number;
  failed: number;
  /** Message de la première erreur (bouton « Actualiser »). */
  error: string | null;
}

/**
 * Synchronise les abonnements dus : `manual` (bouton, un abonnement `id`) → au plus aux
 * 2 min ; sinon au plus aux 6 h. Ne lève jamais d'erreur. En cas d'échec, la dernière version
 * connue reste et l'erreur est notée (affichée dans Profil).
 */
export async function syncSubscriptions(
  deps: SubscriptionDeps,
  options: { manual: boolean; id?: string | null },
): Promise<SyncSummary> {
  let claimed: ClaimedSubscription[];
  try {
    claimed = await deps.store.claim(
      options.manual ? SUBSCRIPTION_MANUAL_SYNC_MINUTES : SUBSCRIPTION_AUTO_SYNC_MINUTES,
      options.id ?? null,
    );
  } catch (e) {
    return { synced: 0, failed: 0, error: messageOf(e) };
  }
  const results = await Promise.all(
    claimed.map(async (c) => {
      try {
        const rows =
          c.kind === "ics"
            ? (await pullIcs(deps, c.url)).rows
            : await pullOutlook(
                deps,
                c.outlookCalendarId,
                await outlookName(deps, c.outlookCalendarId),
              );
        await deps.store.replaceEvents(c.id, rows);
        return null;
      } catch (e) {
        const message = messageOf(e);
        await deps.store.failSync(c.id, message).catch((err: unknown) => {
          console.error(
            "Calendrier abonné : échec non noté :",
            err instanceof Error ? err.message : err,
          );
        });
        return message;
      }
    }),
  );
  const errors = results.filter((r): r is string => r !== null);
  return {
    synced: results.length - errors.length,
    failed: errors.length,
    error: errors[0] ?? null,
  };
}

/** Nom actuel d'un calendrier Outlook (le titre des événements), ou « Calendrier Outlook ». */
async function outlookName(deps: SubscriptionDeps, calendarId: string): Promise<string> {
  if (!deps.outlook) return "Calendrier Outlook";
  const list = await deps.outlook.calendars();
  const found = list.find((c) => c.id === calendarId);
  if (!found) {
    throw new SubscriptionError("Ce calendrier n'existe plus dans ton compte Outlook. Retire-le.");
  }
  return cleanName(found.name, "Calendrier Outlook");
}

/**
 * Calendriers du compte Outlook qu'on peut ajouter : ni celui déjà lu par le connecteur, ni
 * ceux déjà abonnés. Les calendriers en lecture seule (abonnés dans Outlook) d'abord.
 */
export async function outlookCandidates(
  deps: SubscriptionDeps,
): Promise<
  | { ok: true; calendars: { id: string; name: string; readOnly: boolean }[] }
  | { ok: false; error: string }
> {
  if (!deps.outlook) return { ok: false, error: "Connecte d'abord Outlook (plus haut)." };
  try {
    const [list, synced, taken] = await Promise.all([
      deps.outlook.calendars(),
      deps.outlook.syncedCalendarId(),
      deps.store.outlookCalendarIds(),
    ]);
    const skip = new Set(taken);
    const calendars = list
      .filter((c) => !skip.has(c.id) && !(synced === null ? c.isDefault : c.id === synced))
      .sort((a, b) => Number(b.readOnly) - Number(a.readOnly) || a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ id: c.id, name: c.name, readOnly: c.readOnly }));
    return { ok: true, calendars };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
