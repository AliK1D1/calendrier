import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchCalendarText, guardedLookup } from "../safeFetch";

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/f1.ics") {
      res.writeHead(200, { "Content-Type": "text/calendar" });
      res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    } else if (req.url === "/redirige") {
      res.writeHead(302, { Location: "/f1.ics" });
      res.end();
    } else if (req.url === "/vers-metadonnees") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else if (req.url === "/boucle") {
      res.writeHead(302, { Location: "/boucle" });
      res.end();
    } else if (req.url === "/gros") {
      res.writeHead(200);
      res.end("x".repeat(2000));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

/** Dans ces tests seulement : le serveur local est permis (le vrai contrôle est remplacé). */
const local = {
  checkUrl: (url: string) =>
    new URL(url).hostname === "127.0.0.1" || new URL(url).hostname === "localhost"
      ? { ok: true as const, url }
      : { ok: false as const, error: "Ce lien pointe vers une adresse interne." },
  isAllowedAddress: () => true,
};

describe("téléchargement protégé d'un calendrier", () => {
  it("télécharge et suit une redirection", async () => {
    expect(await fetchCalendarText(`http://127.0.0.1:${port}/f1.ics`, local)).toMatch(
      /BEGIN:VCALENDAR/,
    );
    expect(await fetchCalendarText(`http://127.0.0.1:${port}/redirige`, local)).toMatch(
      /VCALENDAR/,
    );
  });

  it("refuse un nom qui pointe vers une adresse interne (vérifié au moment de la connexion)", async () => {
    await expect(
      fetchCalendarText(`http://localhost:${port}/f1.ics`, { checkUrl: local.checkUrl }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("revérifie chaque redirection, et s'arrête après 3", async () => {
    await expect(
      fetchCalendarText(`http://127.0.0.1:${port}/vers-metadonnees`, local),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(fetchCalendarText(`http://127.0.0.1:${port}/boucle`, local)).rejects.toThrow(
      /trop de fois/,
    );
  });

  it("par défaut, refuse tout lien interne sans se connecter", async () => {
    await expect(fetchCalendarText(`http://127.0.0.1:${port}/f1.ics`)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("taille maximale et lien brisé", async () => {
    await expect(
      fetchCalendarText(`http://127.0.0.1:${port}/gros`, { ...local, maxBytes: 1000 }),
    ).rejects.toThrow(/trop gros/);
    await expect(fetchCalendarText(`http://127.0.0.1:${port}/absent`, local)).rejects.toMatchObject(
      { kind: "gone" },
    );
  });

  it("guardedLookup refuse si une seule des adresses est interne", async () => {
    const lookup = guardedLookup((a) => a === "8.8.8.8", ((
      _h: string,
      _o: unknown,
      cb: (e: null, a: { address: string; family: number }[]) => void,
    ) =>
      cb(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ])) as unknown as typeof import("node:dns").lookup);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      lookup("exemple.com", {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe("EADDRNOTALLOWED");
  });
});
