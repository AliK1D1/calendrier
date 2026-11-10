import { describe, expect, it } from "vitest";

import { splitQuestion } from "../confirm";

describe("splitQuestion", () => {
  it("sépare la question de l'explication", () => {
    expect(splitQuestion("Annuler « Souper » ? Il sera retiré de l'horaire de tous.")).toEqual({
      title: "Annuler « Souper » ?",
      body: "Il sera retiré de l'horaire de tous.",
    });
  });
  it("question seule : pas d'explication", () => {
    expect(splitQuestion("Supprimer « Café » des lieux du groupe ?")).toEqual({
      title: "Supprimer « Café » des lieux du groupe ?",
    });
  });
  it("garde le saut de ligne hors du titre", () => {
    expect(splitQuestion("Supprimer « Chimie » ?\nSes 2 séances seront retirées.")).toEqual({
      title: "Supprimer « Chimie » ?",
      body: "Ses 2 séances seront retirées.",
    });
  });
  it("ignore un point d'interrogation dans un nom entre guillemets", () => {
    expect(splitQuestion("Annuler « On sort ? » ? Tout le monde sera averti.")).toEqual({
      title: "Annuler « On sort ? » ?",
      body: "Tout le monde sera averti.",
    });
    expect(splitQuestion("Cancel “Out tonight?”? Everyone will be told.")).toEqual({
      title: "Cancel “Out tonight?”?",
      body: "Everyone will be told.",
    });
  });
  it("sans point d'interrogation : tout est le titre", () => {
    expect(splitQuestion("  Confirmer  ")).toEqual({ title: "Confirmer" });
  });
  it("un guillemet fermant orphelin ne bloque pas la coupure", () => {
    expect(splitQuestion("Retirer » ? Oui.")).toEqual({ title: "Retirer » ?", body: "Oui." });
  });
});
