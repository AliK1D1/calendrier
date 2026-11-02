import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PlaceInput } from "@/lib/places/validation";
import type { BlockSpec } from "@/lib/scheduling/weeklyBlocks";

import { parseIcs } from "../ics";
import {
  confirmIcsImport,
  type IcsConfirmInput,
  type IcsStore,
  previewIcsImport,
  validateIcsConfirm,
} from "../icsImport";

const FIXTURE = readFileSync(join(__dirname, "fixtures/horaire-hiver-2027.ics"), "utf8");
const TODAY = "2026-11-02";
const CEGEP = "11111111-1111-4111-8111-111111111111";

/** Faux magasin : garde la liste des appels et un « horaire » en mémoire. */
function fakeStore(fail: Partial<Record<keyof IcsStore, boolean>> = {}) {
  const calls: string[] = [];
  const state = {
    blocks: [{ id: "ancien", source: "ics", createdAt: "2026-10-01T00:00:00Z" }] as {
      id: string;
      source: string;
      createdAt: string;
      spec?: BlockSpec;
    }[],
    places: [] as (PlaceInput & { id: string })[],
  };
  const err = (name: string) => ({ ok: false as const, error: `échec ${name}` });
  const store: IcsStore = {
    async countIcsBlocks() {
      calls.push("countIcsBlocks");
      return { ok: true, value: state.blocks.filter((b) => b.source === "ics").length };
    },
    async createPlaces(places) {
      calls.push("createPlaces");
      if (fail.createPlaces) return err("createPlaces");
      const ids = places.map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      state.places.push(...places.map((p, i) => ({ ...p, id: ids[i] })));
      return { ok: true, value: ids };
    },
    async deletePlaces(ids) {
      calls.push("deletePlaces");
      state.places = state.places.filter((p) => !ids.includes(p.id));
      return { ok: true, value: undefined };
    },
    async insertIcsBlocks(blocks) {
      calls.push("insertIcsBlocks");
      if (fail.insertIcsBlocks) return err("insertIcsBlocks");
      const createdAt = "2026-11-02T12:00:00Z";
      state.blocks.push(
        ...blocks.map((spec, i) => ({ id: `nouveau${i}`, source: "ics", createdAt, spec })),
      );
      return { ok: true, value: { createdAt } };
    },
    async deleteIcsBlocksBefore(createdAt) {
      calls.push("deleteIcsBlocksBefore");
      if (fail.deleteIcsBlocksBefore) return err("deleteIcsBlocksBefore");
      const before = state.blocks.length;
      state.blocks = state.blocks.filter((b) => b.source !== "ics" || b.createdAt >= createdAt);
      return { ok: true, value: before - state.blocks.length };
    },
  };
  return { store, calls, state };
}

/** Confirmation « telle que l'aperçu la renverrait » pour le fichier d'exemple. */
function confirmFromFixture(
  choose: (location: string) => IcsConfirmInput["places"][number]["choice"],
): IcsConfirmInput {
  const r = parseIcs(FIXTURE, { today: TODAY });
  if (!r.ok) throw new Error(r.error);
  return {
    blocks: r.value.blocks.map((b) => ({
      title: b.title,
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      weekday: b.weekday,
      validFrom: b.validFrom,
      validUntil: b.validUntil,
      locationText: b.locationText,
    })),
    places: r.value.locations.map((l) => ({ locationText: l, choice: choose(l) })),
  };
}

const file = (text: string) => ({
  size: new TextEncoder().encode(text).length,
  text: async () => text,
});

describe("previewIcsImport : rien n'est écrit avant la confirmation", () => {
  it("l'aperçu ne fait que lire (compte des blocs déjà importés)", async () => {
    const { store, calls, state } = fakeStore();
    const r = await previewIcsImport(store, file(FIXTURE), TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.blocks).toHaveLength(13);
      expect(r.existingIcs).toBe(1);
    }
    expect(calls).toEqual(["countIcsBlocks"]);
    expect(state.blocks.map((b) => b.id)).toEqual(["ancien"]);
    expect(state.places).toEqual([]);
  });

  it("fichier trop gros : refusé sans le lire ni toucher à la BD", async () => {
    const { store, calls } = fakeStore();
    let read = false;
    const r = await previewIcsImport(
      store,
      {
        size: 2_000_000,
        text: async () => {
          read = true;
          return "";
        },
      },
      TODAY,
    );
    expect(r).toEqual({ ok: false, error: "Le fichier est trop gros (1 Mo au maximum)." });
    expect(read).toBe(false);
    expect(calls).toEqual([]);
  });

  it("fichier invalide : message d'erreur, aucun accès BD", async () => {
    const { store, calls } = fakeStore();
    expect(await previewIcsImport(store, file("pas un calendrier"), TODAY)).toMatchObject({
      ok: false,
    });
    expect(calls).toEqual([]);
  });
});

describe("confirmIcsImport : ré-import qui remplace les blocs « ics »", () => {
  it("crée les lieux, insère les nouveaux blocs puis retire les anciens (dans cet ordre)", async () => {
    const { store, calls, state } = fakeStore();
    const input = confirmFromFixture((l) =>
      l.startsWith("Café")
        ? { kind: "new", name: "Café Le Grain", lat: 45.56, lng: -73.71 }
        : { kind: "place", id: CEGEP },
    );
    const r = await confirmIcsImport(store, input);
    expect(r).toEqual({ ok: true, imported: 13, replaced: 1, placesCreated: 1 });
    expect(calls).toEqual(["createPlaces", "insertIcsBlocks", "deleteIcsBlocksBefore"]);
    expect(state.blocks.some((b) => b.id === "ancien")).toBe(false);
    const job = state.blocks.find((b) => b.spec?.title === "Travail au café");
    expect(job?.spec?.placeId).toBe(state.places[0].id);
    const chem = state.blocks.find((b) => b.spec?.title === "Chimie générale");
    expect(chem?.spec?.placeId).toBe(CEGEP);
  });

  it("deuxième import du même fichier : aucun doublon", async () => {
    const { store, state } = fakeStore();
    const input = confirmFromFixture(() => ({ kind: "home" }));
    await confirmIcsImport(store, input);
    // Le deuxième import a un created_at plus récent.
    state.blocks = state.blocks.map((b) => ({ ...b, createdAt: "2026-11-01T00:00:00Z" }));
    const r = await confirmIcsImport(store, input);
    expect(r).toMatchObject({ ok: true, imported: 13, replaced: 13 });
    expect(state.blocks).toHaveLength(13);
  });

  it("insertion refusée : l'ancien horaire reste, les lieux créés sont retirés", async () => {
    const { store, calls, state } = fakeStore({ insertIcsBlocks: true });
    const input = confirmFromFixture(() => ({
      kind: "new",
      name: "Cégep",
      lat: 45.5,
      lng: -73.6,
    }));
    const r = await confirmIcsImport(store, input);
    expect(r).toEqual({ ok: false, error: "échec insertIcsBlocks" });
    expect(calls).toEqual(["createPlaces", "insertIcsBlocks", "deletePlaces"]);
    expect(state.blocks.map((b) => b.id)).toEqual(["ancien"]);
    expect(state.places).toEqual([]);
  });

  it("suppression des anciens refusée : message clair (le ré-import corrigera)", async () => {
    const { store } = fakeStore({ deleteIcsBlocksBefore: true });
    const r = await confirmIcsImport(
      store,
      confirmFromFixture(() => ({ kind: "home" })),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/Réimporte/);
  });

  it("données invalides : rien n'est écrit", async () => {
    const { store, calls } = fakeStore();
    const input = confirmFromFixture(() => ({ kind: "home" }));
    input.blocks[0].title = "x".repeat(101);
    expect(await confirmIcsImport(store, input)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("validateIcsConfirm", () => {
  const base = (): IcsConfirmInput => ({
    blocks: [
      {
        title: "Chimie",
        startMinute: 600,
        endMinute: 720,
        weekday: 1,
        validFrom: "2027-01-18",
        validUntil: "2027-05-10",
        locationText: "B-201",
      },
    ],
    places: [{ locationText: "B-201", choice: { kind: "place", id: CEGEP } }],
  });

  it("accepte un import valide", () => {
    const v = validateIcsConfirm(base());
    expect(v).toEqual({
      ok: true,
      value: {
        newPlaces: [],
        blocks: [
          {
            newPlace: null,
            spec: {
              title: "Chimie",
              placeId: CEGEP,
              startMinute: 600,
              endMinute: 720,
              weekday: 1,
              validFrom: "2027-01-18",
              validUntil: "2027-05-10",
            },
          },
        ],
      },
    });
  });

  it("applique les limites de la BD : titre ≤ 100, période < 366 jours", () => {
    const long = base();
    long.blocks[0].title = "x".repeat(101);
    expect(validateIcsConfirm(long)).toMatchObject({ ok: false });
    const span = base();
    span.blocks[0].validUntil = "2028-01-19"; // 366 jours
    expect(validateIcsConfirm(span)).toMatchObject({ ok: false });
  });

  it("refuse un lieu manquant, un identifiant invalide, un jour de semaine invalide", () => {
    const missing = base();
    missing.places = [];
    expect(validateIcsConfirm(missing)).toEqual({
      ok: false,
      error: "Choisis un lieu pour « B-201 ».",
    });
    const badId = base();
    badId.places[0].choice = { kind: "place", id: "pas-un-uuid" };
    expect(validateIcsConfirm(badId)).toMatchObject({ ok: false });
    const badDay = base();
    badDay.blocks[0].weekday = 8;
    expect(validateIcsConfirm(badDay)).toMatchObject({ ok: false });
    expect(validateIcsConfirm({ blocks: [], places: [] })).toMatchObject({ ok: false });
    expect(validateIcsConfirm(null)).toMatchObject({ ok: false });
  });

  it("bloc ponctuel : un seul jour ; sans lieu dans le fichier : la maison", () => {
    const once = base();
    once.blocks[0] = {
      ...once.blocks[0],
      weekday: null,
      validFrom: "2027-03-24",
      validUntil: "2027-03-24",
      locationText: "",
    };
    const v = validateIcsConfirm(once);
    expect(v.ok && v.value.blocks[0].spec).toMatchObject({ weekday: null, placeId: null });
    once.blocks[0].validUntil = "2027-03-25";
    expect(validateIcsConfirm(once)).toMatchObject({ ok: false });
  });

  it("un nouveau lieu qui ne sert à aucun bloc gardé n'est pas créé", () => {
    const input = base();
    input.places.push({
      locationText: "Inutile",
      choice: { kind: "new", name: "Inutile", lat: 45, lng: -73 },
    });
    const v = validateIcsConfirm(input);
    expect(v.ok && v.value.newPlaces).toEqual([]);
  });

  it("nouveau lieu : nom et coordonnées validés", () => {
    const input = base();
    input.places[0].choice = { kind: "new", name: "B-201", lat: 200, lng: -73 };
    expect(validateIcsConfirm(input)).toMatchObject({ ok: false });
  });
});
