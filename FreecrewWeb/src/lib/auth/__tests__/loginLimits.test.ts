import { describe, expect, it } from "vitest";

import {
  allowLoginAttempt,
  clientIp,
  createSignupLimiters,
  createPasswordLimiters,
} from "@/lib/auth/loginLimits";

const MINUTE = 60_000;

describe("limites de connexion (revue)", () => {
  it("mot de passe : 10 essais par courriel en 15 min, puis refus ; de nouveau permis après", () => {
    let t = 0;
    const l = createPasswordLimiters(() => t);
    for (let i = 0; i < 10; i++) expect(allowLoginAttempt(l, "1.2.3.4", "ali@x.com")).toBe(true);
    expect(allowLoginAttempt(l, "5.6.7.8", "ali@x.com")).toBe(false); // autre IP, même compte
    expect(allowLoginAttempt(l, "1.2.3.4", "sam@x.com")).toBe(true); // autre compte
    t += 15 * MINUTE + 1;
    expect(allowLoginAttempt(l, "1.2.3.4", "ali@x.com")).toBe(true);
  });

  it("mot de passe : 50 essais par IP en 15 min, quel que soit le courriel", () => {
    const l = createPasswordLimiters(() => 0);
    for (let i = 0; i < 50; i++) expect(allowLoginAttempt(l, "1.2.3.4", `u${i}@x.com`)).toBe(true);
    expect(allowLoginAttempt(l, "1.2.3.4", "nouveau@x.com")).toBe(false);
    expect(allowLoginAttempt(l, "9.9.9.9", "nouveau@x.com")).toBe(true);
  });

  it("création de compte : 5 par courriel et 20 par IP en une heure", () => {
    const l = createSignupLimiters(() => 0);
    for (let i = 0; i < 5; i++) expect(allowLoginAttempt(l, "1.1.1.1", "ali@x.com")).toBe(true);
    expect(allowLoginAttempt(l, "1.1.1.1", "ali@x.com")).toBe(false);
    const m = createSignupLimiters(() => 0);
    for (let i = 0; i < 20; i++) expect(allowLoginAttempt(m, "2.2.2.2", `u${i}@x.com`)).toBe(true);
    expect(allowLoginAttempt(m, "2.2.2.2", "autre@x.com")).toBe(false);
  });

  it("IP du visiteur : première valeur de x-forwarded-for, sinon x-real-ip, sinon « inconnue »", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("inconnue");
    expect(clientIp(h({ "x-forwarded-for": "a".repeat(500) }))).toHaveLength(64);
  });
});
