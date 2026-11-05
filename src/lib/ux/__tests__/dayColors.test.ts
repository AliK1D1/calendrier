import { describe, expect, it } from "vitest";

import { dayColorStyle, dayColorVar } from "../dayColors";

describe("dayColorVar", () => {
  it("donne une couleur différente à chacun des 7 jours", () => {
    const vars = ([1, 2, 3, 4, 5, 6, 7] as const).map(dayColorVar);
    expect(new Set(vars).size).toBe(7);
    expect(vars[0]).toBe("var(--jour-1)");
    expect(vars[6]).toBe("var(--jour-7)");
  });
});

describe("dayColorStyle", () => {
  it("expose la couleur du jour dans la variable --jour", () => {
    expect(dayColorStyle(3)).toEqual({ "--jour": "var(--jour-3)" });
  });
});
