import { describe, expect, it } from "vitest";

import { isAllowedHostname, isPublicAddress, normalizeSubscriptionUrl } from "../url";

describe("lien d'un calendrier abonné", () => {
  it("accepte https, http et webcal (changé en https)", () => {
    expect(normalizeSubscriptionUrl(" webcal://ics.ecal.com/f1.ics ")).toEqual({
      ok: true,
      url: "https://ics.ecal.com/f1.ics",
      host: "ics.ecal.com",
    });
    expect(normalizeSubscriptionUrl("webcals://example.com/a.ics")).toMatchObject({
      ok: true,
      url: "https://example.com/a.ics",
    });
    expect(normalizeSubscriptionUrl("http://example.com/a.ics?x=1#frag")).toMatchObject({
      ok: true,
      url: "http://example.com/a.ics?x=1",
    });
    expect(normalizeSubscriptionUrl("https://example.com:443/a.ics")).toMatchObject({ ok: true });
  });

  it("refuse les autres protocoles, les identifiants, les ports et les noms internes", () => {
    for (const bad of [
      "",
      "ftp://example.com/a.ics",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com/a.ics",
      "https://example.com:8080/a.ics",
      "http://localhost/a.ics",
      "http://LOCALHOST./a.ics",
      "http://printer.local/a.ics",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://intranet/a.ics",
      "http://127.0.0.1/a.ics",
      "http://2130706433/a.ics",
      "http://0x7f.0.0.1/a.ics",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/a.ics",
      "http://[::1]/a.ics",
      "http://[::ffff:127.0.0.1]/a.ics",
      "http://[fd00::1]/a.ics",
      "https://example.com/" + "a".repeat(2000),
    ]) {
      expect(normalizeSubscriptionUrl(bad).ok, bad).toBe(false);
    }
  });

  it("adresses IP publiques ou non", () => {
    for (const ok of ["8.8.8.8", "142.250.80.46", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
    for (const no of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "192.0.2.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:10.0.0.1",
      "::ffff:7f00:1",
      "64:ff9b::a9fe:a9fe",
      "2002:c0a8:0101::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "2001::1",
      "pas une ip",
      "1:2:3",
    ]) {
      expect(isPublicAddress(no), no).toBe(false);
    }
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("noms d'hôte", () => {
    expect(isAllowedHostname("calendar.google.com")).toBe(true);
    expect(isAllowedHostname("[2606:4700:4700::1111]")).toBe(true);
    expect(isAllowedHostname("router.home.arpa")).toBe(false);
    expect(isAllowedHostname("a..b.com")).toBe(false);
  });
});
