import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import { cn } from "@/lib/utils";

describe("mise en place", () => {
  it("fusionne les classes Tailwind", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("formate une date dans le fuseau America/Toronto", () => {
    // 2025-01-15 17:00 UTC = 12:00 à Toronto (HNE, UTC-5)
    const d = new Date("2025-01-15T17:00:00Z");
    expect(formatInTimeZone(d, "America/Toronto", "HH:mm")).toBe("12:00");
  });
});
