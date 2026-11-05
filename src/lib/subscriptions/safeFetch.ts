/**
 * Téléchargement d'un calendrier abonné, protégé contre la falsification de requête côté
 * serveur (SSRF). Le lien vient de la personne : sans protection, il pourrait faire lire au
 * serveur de l'app une adresse interne (métadonnées infonuagiques 169.254.169.254, services
 * du réseau local…).
 *
 * Protections :
 * - le lien est vérifié par `normalizeSubscriptionUrl` (http/https, port par défaut, pas de
 *   nom interne ni d'IP privée écrite dans le lien) ;
 * - le nom est résolu par le DNS **au moment de la connexion** (`lookup` de node:http) et
 *   **toutes** les adresses doivent être publiques : un nom qui pointe vers une adresse
 *   interne (ou qui change entre la vérification et la connexion, « DNS rebinding ») est
 *   refusé, puisqu'on se connecte à l'adresse qui vient d'être vérifiée ;
 * - au plus 3 redirections, chacune revérifiée de la même façon (jamais de https → http) ;
 * - au plus 1 Mo, 10 s en tout, sans décompression (pas de « bombe gzip ») ;
 * - aucun cookie ni en-tête d'authentification n'est envoyé.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { ICS_MAX_BYTES } from "@/lib/import/limits";

import { isPublicAddress, normalizeSubscriptionUrl } from "./url";

/** Erreur de téléchargement ; le message est affiché tel quel (en français). */
export class FeedError extends Error {
  constructor(
    message: string,
    /** `gone` : le lien ne marche plus (404, 410…) ; `unavailable` : réessayer plus tard. */
    readonly kind: "gone" | "unavailable" | "invalid" | "forbidden",
  ) {
    super(message);
    this.name = "FeedError";
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Vérification d'une adresse IP résolue (tests seulement : défaut `isPublicAddress`). */
  isAllowedAddress?: (address: string) => boolean;
  /** Vérification du lien (tests seulement : défaut `normalizeSubscriptionUrl`). */
  checkUrl?: (url: string) => { ok: true; url: string } | { ok: false; error: string };
}

export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_REDIRECTS = 3;

const UNAVAILABLE = "Le calendrier ne répond pas. On garde la dernière version connue.";

/**
 * `lookup` pour node:http : résout le nom, refuse si une des adresses n'est pas permise, et
 * donne à node l'adresse vérifiée (la connexion se fait donc à celle-là).
 */
export function guardedLookup(
  isAllowed: (address: string) => boolean,
  resolve: typeof dnsLookup = dnsLookup,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[];
      if (list.length === 0 || list.some((a) => !isAllowed(a.address))) {
        const e = new Error("Adresse interne refusée") as NodeJS.ErrnoException;
        e.code = "EADDRNOTALLOWED";
        return callback(e, "", 4);
      }
      if (options.all) return callback(null, list as unknown as string, 4);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

interface RawResponse {
  status: number;
  location: string | null;
  body: string;
}

function requestOnce(
  url: string,
  lookup: LookupFunction,
  deadline: number,
  maxBytes: number,
): Promise<RawResponse> {
  return new Promise((resolveOnce, rejectOnce) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return rejectOnce(new FeedError(UNAVAILABLE, "unavailable"));
    // Revue abonnements 1 : `timeout` de node ne compte que l'attente entre deux morceaux.
    // Un serveur qui envoie un octet de temps en temps gardait la requête ouverte bien après
    // 10 s (jusqu'à ce que Vercel coupe la fonction). Ce minuteur coupe tout au délai total.
    const timer = setTimeout(() => {
      req.destroy();
      rejectOnce(new FeedError(UNAVAILABLE, "unavailable"));
    }, remaining);
    const resolve = (r: RawResponse) => {
      clearTimeout(timer);
      resolveOnce(r);
    };
    const reject = (e: unknown) => {
      clearTimeout(timer);
      rejectOnce(e);
    };
    const req = lib.request(
      u,
      {
        method: "GET",
        lookup,
        agent: false,
        timeout: remaining,
        headers: {
          Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": "TempsLibreCommun/1.0 (calendrier abonné)",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, body: "" });
        }
        if (status !== 200) {
          res.resume();
          return resolve({ status, location: null, body: "" });
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          return reject(new FeedError("Ce calendrier est trop gros (1 Mo au maximum).", "invalid"));
        }
        if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
          res.destroy();
          return reject(new FeedError("Réponse inattendue du calendrier.", "invalid"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FeedError("Ce calendrier est trop gros (1 Mo au maximum).", "invalid"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status, location: null, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", () => reject(new FeedError(UNAVAILABLE, "unavailable")));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new FeedError(UNAVAILABLE, "unavailable"));
    });
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof FeedError) return reject(e);
      if (e.code === "EADDRNOTALLOWED") {
        return reject(
          new FeedError(
            "Ce lien pointe vers une adresse interne : seuls les calendriers publics sur Internet sont acceptés.",
            "forbidden",
          ),
        );
      }
      if (e.code === "ENOTFOUND") {
        return reject(new FeedError("Ce site n'existe pas (adresse introuvable).", "gone"));
      }
      reject(new FeedError(UNAVAILABLE, "unavailable"));
    });
    req.end();
  });
}

/** Message selon le code HTTP d'une réponse qui n'est pas 200. */
function statusError(status: number): FeedError {
  if (status === 401 || status === 403) {
    return new FeedError("Ce calendrier est privé : le site refuse l'accès.", "gone");
  }
  if (status === 404 || status === 410) {
    return new FeedError("Ce lien ne fonctionne plus (calendrier introuvable).", "gone");
  }
  return new FeedError(UNAVAILABLE, "unavailable");
}

/** Télécharge le texte du calendrier à `url` (déjà normalisée), ou lève une `FeedError`. */
export async function fetchCalendarText(
  url: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? FEED_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? ICS_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? FEED_MAX_REDIRECTS;
  const checkUrl = options.checkUrl ?? normalizeSubscriptionUrl;
  const lookup = guardedLookup(options.isAllowedAddress ?? isPublicAddress);
  const deadline = Date.now() + timeoutMs;

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = checkUrl(current);
    if (!checked.ok) throw new FeedError(checked.error, "forbidden");
    const res = await requestOnce(checked.url, lookup, deadline, maxBytes);
    if (res.status === 200) return res.body;
    if (res.status >= 300 && res.status < 400 && res.location) {
      let next: URL;
      try {
        next = new URL(res.location, checked.url);
      } catch {
        throw new FeedError("Réponse inattendue du calendrier.", "invalid");
      }
      if (new URL(checked.url).protocol === "https:" && next.protocol === "http:") {
        throw new FeedError("Le calendrier redirige vers une adresse non sécurisée.", "invalid");
      }
      current = next.toString();
      continue;
    }
    throw statusError(res.status);
  }
  throw new FeedError("Le calendrier redirige trop de fois.", "invalid");
}
