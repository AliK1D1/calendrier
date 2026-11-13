/**
 * Confirmation d'un import `.ics` : validation de ce que le navigateur renvoie après l'aperçu
 * (blocs gardés + lieu choisi pour chaque « LOCATION ») et enregistrement via un `IcsStore`
 * injecté (Supabase dans l'app, faux magasin dans les tests). Aucun accès BD direct ici.
 *
 * Rien n'est écrit pendant l'aperçu (`previewIcsImport` ne fait que lire). À la confirmation
 * (`confirmIcsImport`), dans cet ordre :
 * 1. création des nouveaux lieux (une requête) ;
 * 2. insertion de **tous** les nouveaux blocs `source = 'ics'` (une requête : tout ou rien) ;
 * 3. suppression des anciens blocs `ics` de la personne, créés **avant** les nouveaux.
 * Si l'étape 2 échoue, les anciens blocs restent intacts et les lieux créés sont retirés. Si
 * l'étape 3 échoue, l'horaire a temporairement les deux versions ; un nouvel import corrige
 * (il remplace tous les blocs `ics`). On ne perd donc jamais l'ancien horaire sans le nouveau.
 */
import { type PlaceInput, validatePlaceInput } from "@/lib/places/validation";
import {
  type BlockSpec,
  formatClock,
  MINUTES_PER_DAY,
  validateBlockForm,
  type ValidationResult,
} from "@/lib/scheduling/weeklyBlocks";

import { ICS_LOCATION_MAX, ICS_MAX_BLOCKS, ICS_MAX_BYTES, type IcsPreview, parseIcs } from "./ics";

/** Nombre maximal de lieux créés par un import. */
export const ICS_MAX_NEW_PLACES = 20;

/** Lieu choisi pour un texte « LOCATION » du fichier. */
export type PlaceChoice =
  | { kind: "home" }
  | { kind: "place"; id: string }
  | { kind: "new"; name: string; lat: number; lng: number };

/** Ce que le navigateur envoie à la confirmation. */
export interface IcsConfirmInput {
  blocks: {
    title: string;
    startMinute: number;
    endMinute: number;
    weekday: number | null;
    validFrom: string;
    validUntil: string;
    locationText: string;
  }[];
  places: { locationText: string; choice: PlaceChoice }[];
}

/** Plan d'enregistrement validé. `newPlace` : indice dans `newPlaces` (lieu à créer). */
export interface IcsImportPlan {
  newPlaces: PlaceInput[];
  blocks: { spec: BlockSpec; newPlace: number | null }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isMinute = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MINUTES_PER_DAY;

/** Valide la confirmation. Mêmes règles que le formulaire de bloc (et que la BD). */
export function validateIcsConfirm(raw: unknown): ValidationResult<IcsImportPlan> {
  if (!isRecord(raw) || !Array.isArray(raw.blocks) || !Array.isArray(raw.places)) {
    return { ok: false, error: "Import invalide." };
  }
  if (raw.blocks.length === 0) return { ok: false, error: "Choisis au moins un bloc à importer." };
  if (raw.blocks.length > ICS_MAX_BLOCKS) {
    return { ok: false, error: `Trop de blocs (au plus ${ICS_MAX_BLOCKS}).` };
  }
  if (raw.places.length > ICS_MAX_BLOCKS) return { ok: false, error: "Import invalide." };

  // Lieu choisi pour chaque texte de lieu.
  const newPlaces: PlaceInput[] = [];
  const choices = new Map<string, { placeId: string | null; newPlace: number | null }>();
  for (const p of raw.places) {
    if (!isRecord(p) || typeof p.locationText !== "string" || !isRecord(p.choice)) {
      return { ok: false, error: "Import invalide." };
    }
    if (p.locationText.length > ICS_LOCATION_MAX || choices.has(p.locationText)) {
      return { ok: false, error: "Import invalide." };
    }
    const c = p.choice;
    if (c.kind === "home") {
      choices.set(p.locationText, { placeId: null, newPlace: null });
    } else if (c.kind === "place") {
      if (typeof c.id !== "string" || !UUID.test(c.id)) {
        return { ok: false, error: "Lieu introuvable." };
      }
      choices.set(p.locationText, { placeId: c.id.toLowerCase(), newPlace: null });
    } else if (c.kind === "new") {
      const place = validatePlaceInput(c);
      if (!place.ok) return { ok: false, error: `Nouveau lieu : ${place.error}` };
      if (newPlaces.length >= ICS_MAX_NEW_PLACES) {
        return { ok: false, error: `Trop de nouveaux lieux (au plus ${ICS_MAX_NEW_PLACES}).` };
      }
      choices.set(p.locationText, { placeId: null, newPlace: newPlaces.length });
      newPlaces.push(place.value);
    } else {
      return { ok: false, error: "Import invalide." };
    }
  }

  const blocks: IcsImportPlan["blocks"] = [];
  const used = new Set<number>();
  for (const b of raw.blocks) {
    if (
      !isRecord(b) ||
      typeof b.locationText !== "string" ||
      !isMinute(b.startMinute) ||
      !isMinute(b.endMinute) ||
      typeof b.validFrom !== "string" ||
      typeof b.validUntil !== "string"
    ) {
      return { ok: false, error: "Bloc invalide." };
    }
    // Sans lieu dans le fichier : la maison.
    const choice = b.locationText ? choices.get(b.locationText) : { placeId: null, newPlace: null };
    if (!choice) return { ok: false, error: `Choisis un lieu pour « ${b.locationText} ».` };

    const weekly = b.weekday != null;
    const v = validateBlockForm({
      title: b.title,
      placeId: choice.placeId,
      start: formatClock(b.startMinute),
      end: formatClock(b.endMinute),
      kind: weekly ? "weekly" : "once",
      weekdays: weekly ? [b.weekday] : [],
      date: b.validFrom,
      sessionStart: b.validFrom,
      sessionEnd: b.validUntil,
    });
    if (!v.ok) return { ok: false, error: `« ${String(b.title).slice(0, 40)} » : ${v.error}` };
    if (!weekly && b.validUntil !== b.validFrom) return { ok: false, error: "Bloc invalide." };
    if (choice.newPlace != null) used.add(choice.newPlace);
    blocks.push({ spec: v.value[0], newPlace: choice.newPlace });
  }

  // Lieux à créer qui ne servent à aucun bloc gardé : on ne les crée pas.
  const keep = newPlaces.map((_, i) => used.has(i));
  const renumber = new Map<number, number>();
  const kept: PlaceInput[] = [];
  newPlaces.forEach((p, i) => {
    if (keep[i]) {
      renumber.set(i, kept.length);
      kept.push(p);
    }
  });
  return {
    ok: true,
    value: {
      newPlaces: kept,
      blocks: blocks.map((b) => ({
        spec: b.spec,
        newPlace: b.newPlace == null ? null : (renumber.get(b.newPlace) ?? null),
      })),
    },
  };
}

// ─── Enregistrement (magasin injecté) ──────────────────────────────────────────────────────

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accès BD nécessaires à l'import (toujours au nom de la personne connectée, sous RLS). */
export interface IcsStore {
  /** Nombre de mes blocs `source = 'ics'`. */
  countIcsBlocks(): Promise<StoreResult<number>>;
  /** Crée des lieux (une requête) ; renvoie leurs identifiants dans le même ordre. */
  createPlaces(places: PlaceInput[]): Promise<StoreResult<string[]>>;
  /** Supprime des lieux tout juste créés (annulation). */
  deletePlaces(ids: string[]): Promise<StoreResult<void>>;
  /**
   * Insère les blocs avec `source = 'ics'` en **une** requête (tout ou rien) ; renvoie leur
   * `created_at` (le même pour tous : moment de la transaction).
   */
  insertIcsBlocks(blocks: BlockSpec[]): Promise<StoreResult<{ createdAt: string }>>;
  /** Supprime mes blocs `ics` créés avant `createdAt` ; renvoie leur nombre. */
  deleteIcsBlocksBefore(createdAt: string): Promise<StoreResult<number>>;
}

export type PreviewResult =
  { ok: true; preview: IcsPreview; existingIcs: number } | { ok: false; error: string };

/** Aperçu : lit le fichier et compte mes blocs déjà importés. N'écrit rien. */
export async function previewIcsImport(
  store: Pick<IcsStore, "countIcsBlocks">,
  file: { size: number; text: () => Promise<string> },
  today: string,
): Promise<PreviewResult> {
  if (file.size > ICS_MAX_BYTES) {
    return { ok: false, error: "Le fichier est trop gros (1 Mo au maximum)." };
  }
  if (file.size === 0) return { ok: false, error: "Le fichier est vide." };
  const parsed = parseIcs(await file.text(), { today });
  if (!parsed.ok) return parsed;
  const existing = await store.countIcsBlocks();
  if (!existing.ok) return existing;
  return { ok: true, preview: parsed.value, existingIcs: existing.value };
}

export type ConfirmResult =
  | { ok: true; imported: number; replaced: number; placesCreated: number }
  | { ok: false; error: string };

/** Confirmation : crée les lieux, insère les nouveaux blocs, puis retire les anciens. */
export async function confirmIcsImport(store: IcsStore, raw: unknown): Promise<ConfirmResult> {
  const plan = validateIcsConfirm(raw);
  if (!plan.ok) return plan;

  let placeIds: string[] = [];
  if (plan.value.newPlaces.length > 0) {
    const created = await store.createPlaces(plan.value.newPlaces);
    if (!created.ok) return created;
    placeIds = created.value;
  }

  const specs = plan.value.blocks.map(({ spec, newPlace }) =>
    newPlace == null ? spec : { ...spec, placeId: placeIds[newPlace] },
  );
  const inserted = await store.insertIcsBlocks(specs);
  if (!inserted.ok) {
    if (placeIds.length > 0) await store.deletePlaces(placeIds);
    return inserted;
  }

  const removed = await store.deleteIcsBlocksBefore(inserted.value.createdAt);
  if (!removed.ok) {
    return {
      ok: false,
      error:
        "Le nouvel horaire est importé, mais l'ancien n'a pas pu être retiré. Réimporte le fichier pour corriger.",
    };
  }
  return {
    ok: true,
    imported: specs.length,
    replaced: removed.value,
    placesCreated: placeIds.length,
  };
}
