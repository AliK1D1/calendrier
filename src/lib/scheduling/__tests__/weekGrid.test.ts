import { describe, expect, it } from "vitest";

import { clockOptions, layoutDay, minuteAtFraction, selectionFromDrag } from "../weekGrid";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const it_ = (id: string, start: number, end: number) => ({
  id,
  startMinute: start,
  endMinute: end,
});

describe("layoutDay", () => {
  it("place un bloc selon la plage 7 h → 23 h (16 h)", () => {
    const { placed, hidden } = layoutDay([it_("a", h(11), h(13))]);
    expect(hidden).toEqual([]);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ top: 4 / 16, height: 2 / 16, lane: 0, lanes: 1 });
  });

  it("met côte à côte les blocs qui se chevauchent, en chaîne", () => {
    const { placed } = layoutDay([
      it_("a", h(9), h(11)),
      it_("b", h(10), h(12)),
      it_("c", h(11), h(13)), // réutilise la colonne de a
      it_("d", h(14), h(15)), // seul
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect([byId.a.lane, byId.b.lane, byId.c.lane]).toEqual([0, 1, 0]);
    expect([byId.a.lanes, byId.b.lanes, byId.c.lanes]).toEqual([2, 2, 2]);
    expect(byId.d).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("blocs collés : pas côte à côte", () => {
    const { placed } = layoutDay([it_("a", h(9), h(10)), it_("b", h(10), h(11))]);
    expect(placed.map((p) => p.lanes)).toEqual([1, 1]);
  });

  it("coupe les blocs qui débordent et met à part ceux hors de la plage", () => {
    const { placed, hidden } = layoutDay([
      it_("nuit", h(5), h(8)),
      it_("tot", h(5), h(7)),
      it_("soir", h(22), h(24)),
      it_("tard", h(23), h(24)),
    ]);
    expect(hidden.map((x) => x.id)).toEqual(["tot", "tard"]);
    const nuit = placed.find((p) => p.item.id === "nuit")!;
    expect(nuit).toMatchObject({ top: 0, height: 1 / 16, cutTop: true, cutBottom: false });
    const soir = placed.find((p) => p.item.id === "soir")!;
    expect(soir).toMatchObject({ top: 15 / 16, height: 1 / 16, cutTop: false, cutBottom: true });
  });
});

describe("clic-glisser", () => {
  it("minuteAtFraction arrondit au quart d'heure et reste dans la plage", () => {
    expect(minuteAtFraction(0)).toBe(h(7));
    expect(minuteAtFraction(0.5)).toBe(h(15));
    expect(minuteAtFraction(0.5 + 10 / 960)).toBe(h(15)); // 15 h 10 → 15 h
    expect(minuteAtFraction(1)).toBe(h(22, 45));
    expect(minuteAtFraction(-3)).toBe(h(7));
  });

  it("un glissé couvre les cases de départ et d'arrivée, dans les deux sens", () => {
    const f = (m: number) => (m - h(7)) / h(16);
    expect(selectionFromDrag(f(h(10)), f(h(11, 30)))).toEqual({
      startMinute: h(10),
      endMinute: h(11, 45),
    });
    expect(selectionFromDrag(f(h(11, 30)), f(h(10)))).toEqual({
      startMinute: h(10),
      endMinute: h(11, 45),
    });
  });

  it("un simple clic donne une heure, raccourcie à 23 h en bas de la grille", () => {
    const f = (m: number) => (m - h(7)) / h(16);
    expect(selectionFromDrag(f(h(13, 5)), f(h(13, 5)))).toEqual({
      startMinute: h(13),
      endMinute: h(14),
    });
    expect(selectionFromDrag(f(h(22, 30)), f(h(22, 30)))).toEqual({
      startMinute: h(22, 30),
      endMinute: h(23),
    });
  });

  it("clockOptions : 00:00 à 24:00 par 15 min", () => {
    const o = clockOptions();
    expect(o).toHaveLength(97);
    expect(o[0]).toBe(0);
    expect(o.at(-1)).toBe(1440);
  });
});
