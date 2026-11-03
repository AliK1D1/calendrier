import { describe, expect, it } from "vitest";

import { plural } from "../plural";

describe("plural", () => {
  it("met le singulier pour 0 et 1", () => {
    expect(plural(0, "groupe")).toBe("0 groupe");
    expect(plural(1, "groupe")).toBe("1 groupe");
  });

  it("ajoute un s à partir de 2", () => {
    expect(plural(2, "bloc")).toBe("2 blocs");
    expect(plural(12, "moment en personne", "moments en personne")).toBe("12 moments en personne");
  });

  it("accepte un pluriel irrégulier", () => {
    expect(plural(1, "lieu", "lieux")).toBe("1 lieu");
    expect(plural(3, "lieu", "lieux")).toBe("3 lieux");
  });
});
