/**
 * Revue abonnements 1 : le délai de 10 s vaut pour TOUT le téléchargement, pas seulement
 * pour l'attente entre deux morceaux. Avant, un serveur qui envoyait un octet toutes les
 * quelques secondes gardait la requête ouverte jusqu'à ce que Vercel coupe la fonction.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchCalendarText } from "../safeFetch";

let server: http.Server;
let port = 0;
const timers = new Set<NodeJS.Timeout>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/goutte") {
      // Un octet toutes les 100 ms pendant 3 s : jamais 500 ms sans rien recevoir.
      res.writeHead(200, { "Content-Type": "text/calendar" });
      let n = 0;
      const t = setInterval(() => {
        if (++n > 30 || res.destroyed) {
          clearInterval(t);
          res.end();
          return;
        }
        res.write("x");
      }, 100);
      timers.add(t);
    } else {
      res.writeHead(200);
      res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  for (const t of timers) clearInterval(t);
  server.closeAllConnections();
  server.close();
});

const local = {
  checkUrl: (url: string) => ({ ok: true as const, url }),
  isAllowedAddress: () => true,
};

describe("revue abonnements 1 : délai total du téléchargement", () => {
  it("un serveur qui envoie goutte à goutte est coupé au délai total", async () => {
    const t = Date.now();
    await expect(
      fetchCalendarText(`http://127.0.0.1:${port}/goutte`, { ...local, timeoutMs: 500 }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("un calendrier normal arrive comme avant", async () => {
    expect(
      await fetchCalendarText(`http://127.0.0.1:${port}/f.ics`, { ...local, timeoutMs: 500 }),
    ).toMatch(/VCALENDAR/);
  });
});
