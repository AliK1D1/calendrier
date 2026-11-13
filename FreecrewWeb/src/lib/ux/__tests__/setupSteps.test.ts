import { describe, expect, it } from "vitest";

import { setupSteps } from "../setupSteps";

const vide = { onboarded: false, hasHome: false, blockCount: 0, groups: [] };

describe("setupSteps", () => {
  it("nouveau compte : la première étape est la maison, vers /bienvenue", () => {
    const plan = setupSteps(vide);
    expect(plan.doneCount).toBe(0);
    expect(plan.next?.id).toBe("maison");
    expect(plan.next?.href).toBe("/bienvenue");
  });

  it("accueil passé sans maison : on envoie vers Mes lieux", () => {
    expect(setupSteps({ ...vide, onboarded: true }).next?.href).toBe("/lieux");
  });

  it("maison et horaire faits : il reste le groupe", () => {
    const plan = setupSteps({ ...vide, onboarded: true, hasHome: true, blockCount: 4 });
    expect(plan.doneCount).toBe(2);
    expect(plan.next?.id).toBe("groupe");
  });

  it("seul dans son groupe : l'étape suivante pointe vers l'invitation du groupe", () => {
    const plan = setupSteps({
      ...vide,
      onboarded: true,
      hasHome: true,
      blockCount: 1,
      groups: [{ id: "g1", name: "Gang", memberCount: 1 }],
    });
    expect(plan.next?.id).toBe("ami");
    expect(plan.next?.href).toBe("/groupes/g1#inviter");
  });

  it("tout est prêt : on propose de trouver un moment dans le plus gros groupe", () => {
    const plan = setupSteps({
      onboarded: true,
      hasHome: true,
      blockCount: 3,
      groups: [
        { id: "petit", name: "Duo", memberCount: 2 },
        { id: "gros", name: "La gang", memberCount: 5 },
        { id: "seul", name: "Moi", memberCount: 1 },
      ],
    });
    expect(plan.doneCount).toBe(4);
    expect(plan.next?.id).toBe("moment");
    expect(plan.next?.href).toBe("/groupes/gros#se-voir");
    expect(plan.next?.hint).toContain("La gang");
  });

  it("l'ordre des étapes ne bouge pas même si une étape plus loin est faite", () => {
    const plan = setupSteps({
      ...vide,
      onboarded: true,
      groups: [{ id: "g", name: "G", memberCount: 3 }],
    });
    expect(plan.steps.map((s) => s.id)).toEqual(["maison", "horaire", "groupe", "ami", "moment"]);
    expect(plan.next?.id).toBe("maison");
  });
});
