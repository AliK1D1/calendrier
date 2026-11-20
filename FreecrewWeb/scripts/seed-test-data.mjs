// Remplit une base Supabase de TEST avec les jeux de données de Freecrew
// (src/lib/testdata/freecrew.ts), pour essayer les scénarios de docs/jeux-de-donnees.md à la
// main dans l'app.
//
// Sécurité :
// - seulement la clé publique « anon » : chaque compte de test s'inscrit, puis écrit SES
//   données avec SA session (RLS), par les mêmes fonctions SQL que l'app. Jamais `service_role`.
// - aucune clé dans le dépôt : l'adresse et la clé viennent de variables d'environnement
//   propres au seed (SEED_SUPABASE_URL, SEED_SUPABASE_ANON_KEY), pas de celles de l'app ;
// - refuse la base de l'app (même adresse que NEXT_PUBLIC_SUPABASE_URL ou que .env.local) et
//   demande de retaper l'identifiant du projet : --base-de-test=<ref>.
//
// Usage (Node 22.18 ou plus, qui lit le TypeScript sans compilation) :
//   SEED_SUPABASE_URL=https://<ref>.supabase.co SEED_SUPABASE_ANON_KEY=<clé anon> \
//   SEED_PASSWORD='MotDePasse1' node scripts/seed-test-data.mjs --base-de-test=<ref> [--tag=a]
// Voir docs/jeux-de-donnees.md (section « Essayer à la main »).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { zonedTime } from "../src/lib/scheduling/time.ts";
import {
  GROUPS,
  LATE_BLOCKS,
  PEOPLE,
  PLANS,
  blockRow,
  dayOf,
  nextMonday,
} from "../src/lib/testdata/freecrew.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Règle du mot de passe de l'app : 8 caractères, une majuscule, une minuscule, un chiffre. */
export function isValidPassword(p) {
  return (
    typeof p === "string" && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)
  );
}

/** Courriel et nom d'utilisateur d'un compte de test (`tag` : pour relancer sur la même base). */
export function accountOf(person, { tag = "", domain = "example.com" } = {}) {
  const suffix = tag ? `_${tag}` : "";
  return {
    email: `freecrew.${person.key}${tag ? `.${tag}` : ""}@${domain}`,
    username: `${person.username}${suffix}`.slice(0, 20),
  };
}

/** Le rôle d'une clé Supabase : « anon », « service_role »… ou null si illisible. */
export function keyRole(key) {
  if (typeof key !== "string") return null;
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  const part = key.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

/** Identifiant du projet (« abcd » dans https://abcd.supabase.co), ou null. */
export function projectRef(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : host;
  } catch {
    return null;
  }
}

/**
 * Vérifie qu'on vise bien une base de test. Rend la liste des problèmes (vide = on peut y aller).
 * `appUrls` : adresses de la base de l'app (variables et .env.local), à ne jamais toucher.
 */
export function safetyProblems({ url, key, password, confirmRef, appUrls }) {
  const problems = [];
  const ref = url ? projectRef(url) : null;
  if (!url || !ref) problems.push("SEED_SUPABASE_URL manque ou n'est pas une adresse valide.");
  if (!key) problems.push("SEED_SUPABASE_ANON_KEY manque.");
  else if (keyRole(key) === "service_role") {
    problems.push("Cette clé est une clé secrète (service_role) : utilise la clé « anon ».");
  }
  if (!isValidPassword(password)) {
    problems.push(
      "SEED_PASSWORD manque ou est trop faible (8 caractères, une majuscule, une minuscule, un chiffre).",
    );
  }
  const norm = (u) => u.replace(/\/+$/, "").toLowerCase();
  if (url && appUrls.some((a) => a && norm(a) === norm(url))) {
    problems.push(
      "Cette adresse est celle de la base de l'app : le seed va seulement sur une base de TEST.",
    );
  }
  if (ref && confirmRef !== ref) {
    problems.push(`Confirme la base de test en ajoutant --base-de-test=${ref}`);
  }
  return problems;
}

/**
 * Opérations dont le seed a besoin, faites au nom d'un compte (`uid`).
 * @typedef {object} SeedAdapter
 * @property {(a: { email: string; username: string; password: string; name: string }) => Promise<string>} signUp
 * @property {(uid: string) => Promise<unknown>} completeOnboarding
 * @property {(uid: string, table: string, row: Record<string, unknown>) => Promise<unknown>} insert
 * @property {(uid: string, table: string, id: string, values: Record<string, unknown>) => Promise<unknown>} update
 * @property {(uid: string, table: string, id: string) => Promise<unknown>} remove
 * @property {(uid: string, name: string) => Promise<{ id: string; inviteCode: string }>} createGroup
 * @property {(uid: string, code: string) => Promise<unknown>} joinGroup
 * @property {(uid: string, p: { groupId: string; startsAt: string; endsAt: string; title: string; placeId: string | null; location: string }) => Promise<string>} proposePlan
 * @property {(uid: string, planId: string, accept: boolean) => Promise<unknown>} respondPlan
 */

/**
 * Écrit les jeux de données avec un `adapter` (Supabase pour de vrai, PGlite dans les tests).
 * Les jours sont ceux de la semaine qui commence `monday`. Rend les identifiants créés.
 * @param {SeedAdapter} adapter
 * @param {{ monday: string; tag?: string; domain?: string; password: string; log?: (m: string) => void }} options
 */
export async function runSeed(adapter, { monday, tag = "", domain, password, log = () => {} }) {
  /** @type {Record<string, string>} */
  const uid = {};
  /** @type {Record<string, string>} */
  const placeId = {};
  /** @type {Record<string, string>} */
  const blockId = {};

  for (const person of PEOPLE) {
    const account = accountOf(person, { tag, domain });
    uid[person.key] = await adapter.signUp({ ...account, password, name: person.name });
    log(`Compte ${account.email} (${person.name})`);
  }

  const mapPlace = (key) => (key === null ? null : placeId[key]);

  for (const person of PEOPLE) {
    const me = uid[person.key];
    await adapter.completeOnboarding(me);
    for (const pl of [...person.places, ...(person.deletedPlaces ?? [])]) {
      placeId[pl.id] = randomUUID();
      await adapter.insert(me, "places", {
        id: placeId[pl.id],
        owner_id: me,
        name: pl.name,
        lat: pl.lat,
        lng: pl.lng,
      });
    }
    await adapter.update(me, "profiles", me, {
      display_name: person.name,
      travel_mode: person.travelMode,
      home_place_id: mapPlace(person.home),
      unavailable_before: person.quiet?.before ?? null,
      unavailable_after: person.quiet?.after ?? null,
      max_outings_per_day: person.outings?.perDay ?? null,
      max_outings_per_week: person.outings?.perWeek ?? null,
    });
    for (const b of person.blocks) await insertBlock(adapter, me, b);
    for (const a of person.availabilities ?? []) {
      await adapter.insert(me, "availability_slots", {
        owner_id: me,
        day: dayOf(monday, a.day),
        start_time: a.start,
        end_time: a.end,
        note: a.note,
      });
    }
    // Lieu supprimé après coup : ses blocs restent, sans lieu (la maison est utilisée).
    for (const pl of person.deletedPlaces ?? []) await adapter.remove(me, "places", placeId[pl.id]);
  }

  async function insertBlock(adapter, me, b) {
    const row = blockRow(me, b, monday);
    blockId[b.key] = randomUUID();
    await adapter.insert(me, "busy_blocks", {
      id: blockId[b.key],
      owner_id: me,
      title: row.title,
      place_id: mapPlace(row.place_id),
      start_time: row.start_time,
      end_time: row.end_time,
      weekday: row.weekday,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      repeat_unit: row.repeat_unit ?? null,
      repeat_every: row.repeat_every ?? 1,
    });
    // Les occurrences annulées s'écrivent après coup, comme « Annuler cette fois-ci ».
    if (row.skip_days?.length) {
      await adapter.update(me, "busy_blocks", blockId[b.key], { skip_days: row.skip_days });
    }
  }

  /** @type {Record<string, string>} */
  const groupId = {};
  for (const g of GROUPS) {
    const created = await adapter.createGroup(uid[g.creator], g.name);
    groupId[g.key] = created.id;
    for (const m of g.members) await adapter.joinGroup(uid[m], created.inviteCode);
    log(`Groupe « ${g.name} »`);
  }

  /** @type {Record<string, string>} */
  const planId = {};
  for (const plan of PLANS) {
    const day = dayOf(monday, plan.day);
    planId[plan.key] = await adapter.proposePlan(uid[plan.proposer], {
      groupId: groupId[plan.group],
      startsAt: zonedTime(day, plan.start).toISOString(),
      endsAt: zonedTime(day, plan.end).toISOString(),
      title: plan.title,
      placeId: mapPlace(plan.place),
      location: plan.location,
    });
    for (const k of plan.accepted) await adapter.respondPlan(uid[k], planId[plan.key], true);
    for (const k of plan.declined) await adapter.respondPlan(uid[k], planId[plan.key], false);
    log(`Plan « ${plan.title} » (${day} ${plan.start})`);
  }

  // L'horaire change APRÈS l'acceptation : le plan devient « à revoir ».
  for (const late of LATE_BLOCKS) await insertBlock(adapter, uid[late.person], late.block);

  return { uid, placeId, blockId, groupId, planId };
}

// ─── Adaptateur Supabase (clé anon, une session par compte) ──────────────────────────────

async function supabaseAdapter(url, anonKey) {
  const { createClient } = await import("@supabase/supabase-js");
  const clients = new Map();
  const client = (uid) => {
    const c = clients.get(uid);
    if (!c) throw new Error(`Pas de session pour ${uid}`);
    return c;
  };
  const check = (what, { data, error }) => {
    if (error) throw new Error(`${what} : ${error.message}`);
    return data;
  };
  return {
    async signUp({ email, username, password }) {
      const c = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await c.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) {
        throw new Error(
          `Inscription de ${email} : ${error.message}. Déjà fait sur cette base ? Relance avec --tag=b.`,
        );
      }
      if (!data.session) {
        throw new Error(
          "Supabase demande de confirmer le courriel : désactive « Confirm email » sur la base de test (Authentication → Sign In / Providers → Email).",
        );
      }
      if (data.user.identities?.length === 0) {
        throw new Error(`${email} existe déjà : relance avec --tag=b.`);
      }
      clients.set(data.user.id, c);
      return data.user.id;
    },
    async completeOnboarding(uid) {
      check("Accueil", await client(uid).rpc("complete_onboarding", {}));
    },
    async insert(uid, table, row) {
      check(`Ajout dans ${table}`, await client(uid).from(table).insert(row));
    },
    async update(uid, table, id, values) {
      check(`Modification de ${table}`, await client(uid).from(table).update(values).eq("id", id));
    },
    async remove(uid, table, id) {
      check(`Suppression dans ${table}`, await client(uid).from(table).delete().eq("id", id));
    },
    async createGroup(uid, name) {
      const id = check("Groupe", await client(uid).rpc("create_group", { group_name: name }));
      const row = check(
        "Code d'invitation",
        await client(uid).from("groups").select("invite_code").eq("id", id).single(),
      );
      return { id, inviteCode: row.invite_code };
    },
    async joinGroup(uid, code) {
      check("Rejoindre un groupe", await client(uid).rpc("join_group_by_code", { code }));
    },
    async proposePlan(uid, p) {
      return check(
        "Proposer un plan",
        await client(uid).rpc("propose_meetup", {
          p_group: p.groupId,
          p_starts_at: p.startsAt,
          p_ends_at: p.endsAt,
          p_title: p.title,
          p_place: p.placeId,
          p_location: p.location,
          p_invitees: null,
        }),
      );
    },
    async respondPlan(uid, planId, accept) {
      check(
        "Répondre à un plan",
        await client(uid).rpc("respond_to_meetup", { p_plan: planId, p_accept: accept }),
      );
    },
  };
}

// ─── Lancement en ligne de commande ─────────────────────────────────────────────────────

function readEnvLocal() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const local = readEnvLocal();
  const url = process.env.SEED_SUPABASE_URL ?? local.SEED_SUPABASE_URL;
  const key = process.env.SEED_SUPABASE_ANON_KEY ?? local.SEED_SUPABASE_ANON_KEY;
  const password = process.env.SEED_PASSWORD ?? local.SEED_PASSWORD;
  const tag = arg("tag") ?? "";
  if (tag && !/^[a-z0-9]{1,4}$/.test(tag)) {
    throw new Error("--tag : 1 à 4 lettres minuscules ou chiffres (ex. --tag=b).");
  }
  const problems = safetyProblems({
    url,
    key,
    password,
    confirmRef: arg("base-de-test"),
    appUrls: [process.env.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_URL],
  });
  if (problems.length) {
    console.error("Seed annulé :\n- " + problems.join("\n- "));
    process.exit(1);
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const monday = nextMonday(today);
  const domain = process.env.SEED_EMAIL_DOMAIN ?? "example.com";
  console.log(`Base de test ${projectRef(url)} — semaine du lundi ${monday}`);
  const adapter = await supabaseAdapter(url, key);
  await runSeed(adapter, { monday, tag, domain, password, log: (m) => console.log(`  ✓ ${m}`) });
  console.log(
    `\nTerminé. Connecte-toi avec un des courriels ci-dessus et SEED_PASSWORD (ex. ${accountOf(PEOPLE[0], { tag, domain }).email}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Seed interrompu : ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
