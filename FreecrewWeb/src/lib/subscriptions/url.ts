/**
 * Adresse d'un calendrier abonné (story 3) : lecture du lien collé par la personne et
 * vérifications contre la falsification de requête côté serveur (SSRF). Fonctions pures,
 * sans réseau : la résolution DNS est faite par `safeFetch.ts`, qui vérifie chaque adresse IP
 * avec `isPublicAddress` au moment de la connexion (et à chaque redirection).
 *
 * Accepté : `https://`, `http://` (beaucoup de calendriers publics) et `webcal://` /
 * `webcals://` (changés en `https://`), port par défaut seulement, sans identifiants dans
 * l'adresse. Refusé : adresses IP privées, locales, de liaison, réservées, et noms internes
 * (« localhost », « .local », « .internal »…).
 */

/** Longueur maximale d'une adresse (même limite que la BD). */
export const SUBSCRIPTION_URL_MAX = 2000;

export type UrlResult = { ok: true; url: string; host: string } | { ok: false; error: string };

const INVALID =
  "Ce lien n'est pas un lien de calendrier valide (il commence par https:// ou webcal://).";
const FORBIDDEN =
  "Ce lien pointe vers une adresse interne : seuls les calendriers publics sur Internet sont acceptés.";

const INTERNAL_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".localdomain",
];

/** Lit et vérifie le lien collé par la personne ; renvoie l'adresse à télécharger. */
export function normalizeSubscriptionUrl(raw: string): UrlResult {
  let text = raw.trim();
  if (text.length === 0) return { ok: false, error: "Colle le lien du calendrier." };
  if (text.length > SUBSCRIPTION_URL_MAX) return { ok: false, error: "Ce lien est trop long." };
  text = text.replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: INVALID };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: INVALID };
  if (u.username || u.password) {
    return { ok: false, error: "Retire le nom d'utilisateur et le mot de passe du lien." };
  }
  // `URL` enlève déjà le port par défaut : il reste seulement un port inhabituel.
  if (u.port !== "") return { ok: false, error: FORBIDDEN };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, error: INVALID };
  if (!isAllowedHostname(host)) return { ok: false, error: FORBIDDEN };
  u.hash = "";
  const url = u.toString();
  if (url.length > SUBSCRIPTION_URL_MAX) return { ok: false, error: "Ce lien est trop long." };
  return { ok: true, url, host };
}

/**
 * Nom d'hôte acceptable : une adresse IP publique, ou un nom qui n'est pas interne et qui a
 * au moins un point (« intranet » seul serait résolu sur le réseau local).
 */
export function isAllowedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (parseIpv4(bare) || bare.includes(":")) return isPublicAddress(bare);
  // Écritures d'IPv4 que `URL` ne convertit pas toujours (« 0x7f.1 », « 2130706433 ») :
  // `URL` les ramène normalement en IPv4 ; un nom tout en chiffres reste suspect.
  if (/^[0-9.]+$/.test(bare) || /^0x/i.test(bare)) return false;
  if (!bare.includes(".")) return false;
  if (INTERNAL_SUFFIXES.some((s) => bare === s.replace(/^\./, "") || bare.endsWith(s))) {
    return false;
  }
  return /^[a-z0-9.-]+$/.test(bare) && !bare.startsWith(".") && !bare.includes("..");
}

/** « 192.168.0.1 » → 4 octets ; `null` si ce n'est pas une IPv4 décimale pointée. */
function parseIpv4(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** IPv6 → 8 groupes de 16 bits ; `null` si illisible. Accepte la fin en IPv4 (« ::ffff:1.2.3.4 »). */
function parseIpv6(text: string): number[] | null {
  let s = text.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const v4 = parseIpv4(s.slice(lastColon + 1));
  if (v4) {
    const hex = (n: number) => n.toString(16);
    s = `${s.slice(0, lastColon + 1)}${hex((v4[0] << 8) | v4[1])}:${hex((v4[2] << 8) | v4[3])}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part === "" ? [] : part.split(":"));
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const toWords = (groups: string[]) => groups.map((g) => parseInt(g, 16));
  if (halves.length === 1) return head.length === 8 ? toWords(head) : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...toWords(head), ...Array<number>(fill).fill(0), ...toWords(rest)];
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // « ce réseau », privé, boucle locale
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // liaison locale (métadonnées infonuagiques)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, documentation
  if (a === 192 && b === 88 && c === 99) return false; // relais 6to4
  if (a === 198 && (b === 18 || b === 19)) return false; // tests de performance
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multidiffusion, réservé, diffusion
  return true;
}

/**
 * Vrai si l'adresse IP (texte, v4 ou v6) est publique : sur Internet, pas sur le réseau local
 * du serveur. Une adresse illisible compte comme non publique.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isPublicIpv4(v4);
  const w = parseIpv6(address);
  if (!w) return false;
  // IPv4 dans IPv6 : « ::ffff:a.b.c.d » (mappée) et « ::a.b.c.d » (compatible, ancienne).
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    if (w[5] === 0 && w[6] === 0 && w[7] <= 1) return false; // « :: » et « ::1 »
    return isPublicIpv4([w[6] >> 8, w[6] & 0xff, w[7] >> 8, w[7] & 0xff]);
  }
  // NAT64 (64:ff9b::/96) : l'IPv4 au bout décide.
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
    return isPublicIpv4([w[6] >> 8, w[6] & 0xff, w[7] >> 8, w[7] & 0xff]);
  }
  // 6to4 (2002::/16) : l'IPv4 encodée dans les groupes 2 et 3.
  if (w[0] === 0x2002) {
    return isPublicIpv4([w[1] >> 8, w[1] & 0xff, w[2] >> 8, w[2] & 0xff]);
  }
  // Seul l'espace unicast global (2000::/3) est public, moins la documentation et Teredo.
  if ((w[0] & 0xe000) !== 0x2000) return false;
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x2001 && w[1] === 0) return false; // Teredo
  if (w[0] === 0x2001 && w[1] < 0x0200) return false; // IETF (2001::/23)
  return true;
}
