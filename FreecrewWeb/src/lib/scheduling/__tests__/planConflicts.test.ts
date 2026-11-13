import { describe, expect, it } from "vitest";

import { conflictingBlock, planConflicts } from "../planConflicts";
import { zonedTime } from "../time";
import type { BusyBlock } from "../types";

const day = "2026-11-12";
const block = (id: string, from: string, to: string, d = day): BusyBlock => ({
  id,
  start: zonedTime(d, from),
  end: zonedTime(d, to),
  placeId: "cegep",
  title: id,
});
const plan = { start: zonedTime(day, "18:00"), end: zonedTime(day, "20:00") };

describe("conflictingBlock", () => {
  it("rien quand la personne n'a que le bloc du plan lui-même", () => {
    expect(conflictingBlock(plan, [block("plan", "18:00", "20:00")])).toBeNull();
  });

  it("signale un cours ajouté après coup", () => {
    const blocks = [block("plan", "18:00", "20:00"), block("labo", "17:00", "19:00")];
    expect(conflictingBlock(plan, blocks)?.id).toBe("labo");
  });

  it("un bloc qui touche seulement le plan n'est pas un conflit", () => {
    const blocks = [block("avant", "16:00", "18:00"), block("apres", "20:00", "21:00")];
    expect(conflictingBlock(plan, blocks)).toBeNull();
  });

  it("deux blocs identiques au plan : le deuxième est un conflit (deux plans en même temps)", () => {
    const blocks = [block("plan", "18:00", "20:00"), block("autre", "18:00", "20:00")];
    expect(conflictingBlock(plan, blocks)?.id).toBe("autre");
  });

  it("choisit le bloc qui chevauche le plus, puis le plus tôt", () => {
    const blocks = [block("court", "18:00", "18:30"), block("long", "18:30", "20:00")];
    expect(conflictingBlock(plan, blocks)?.id).toBe("long");
    const egaux = [block("b", "19:00", "20:00"), block("a", "18:00", "19:00")];
    expect(conflictingBlock(plan, egaux)?.id).toBe("a");
  });

  it("ignore les blocs d'un autre jour", () => {
    expect(conflictingBlock(plan, [block("demain", "18:00", "20:00", "2026-11-13")])).toBeNull();
  });

  it("plan qui finit à minuit, le jour du changement d'heure", () => {
    const d = "2026-11-01"; // retour à l'heure normale : journée de 25 h
    const soir = { start: zonedTime(d, "22:00"), end: zonedTime(d, "24:00") };
    expect(conflictingBlock(soir, [block("plan", "22:00", "24:00", d)])).toBeNull();
    expect(conflictingBlock(soir, [block("job", "23:00", "24:00", d)])?.id).toBe("job");
  });
});

describe("planConflicts", () => {
  it("liste les participants pris, avec la durée du chevauchement", () => {
    const blocks = new Map([
      ["ali", [block("plan", "18:00", "20:00")]],
      ["sam", [block("plan", "18:00", "20:00"), block("job", "19:30", "22:00")]],
    ]);
    const r = planConflicts(plan, ["ali", "sam", "zoe", "sam"], blocks);
    expect(r.map((c) => [c.personId, c.block.id, c.overlapMinutes])).toEqual([["sam", "job", 30]]);
  });
});
