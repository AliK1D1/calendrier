/**
 * Notifications poussées de l'app mobile (migration 0023), sur PGlite. pg_net n'existe pas
 * ici : on le remplace par un faux `net.http_post` qui garde chaque requête dans `net.calls`.
 * A propose ; B et C sont invités ; D est dans le groupe mais pas invité au plan « choisi ».
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asUser, FAKE_SUPABASE } from "./pgliteHarness";

const ROOT = join(__dirname, "../../../..");
const SETUP_SQL = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";

const TOKEN = (who: string) => `ExponentPushToken[${who}xxxxxxxxxxxxxxxxxxxx]`;

const FAKE_PG_NET = `
  CREATE SCHEMA net;
  CREATE TABLE net.calls (id serial PRIMARY KEY, url text, body jsonb);
  CREATE FUNCTION net.http_post(
    url text,
    body jsonb DEFAULT '{}'::jsonb,
    params jsonb DEFAULT '{}'::jsonb,
    headers jsonb DEFAULT '{}'::jsonb,
    timeout_milliseconds integer DEFAULT 5000
  ) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint
  $$;
`;

let db: PGlite;
let G: string;

const as = <T>(uid: string | null, fn: () => Promise<T>) => asUser(db, uid, fn);

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

interface Call {
  url: string;
  to: string[];
  title: string;
  body: string;
  data: { url: string; planId: string; kind: string };
  channelId: string;
}

async function calls(): Promise<Call[]> {
  const r = await rows<{ url: string; body: Omit<Call, "url"> }>(
    "SELECT url, body FROM net.calls ORDER BY id",
  );
  return r.map((c) => ({ url: c.url, ...c.body }));
}

const register = (uid: string, token: string, platform = "ios") =>
  as(uid, () => rows("SELECT public.register_push_token($1, $2)", [token, platform]));

/** Propose un plan dans 2 jours, 18 h 30 – 20 h (heure de Montréal). */
async function propose(invitees: string[] | null, title = "Cinéma"): Promise<string> {
  const [r] = await as(A, () =>
    rows<{ id: string }>(
      `SELECT public.propose_meetup($1,
         (date_trunc('day', now() AT TIME ZONE 'America/Toronto') + interval '2 days 18 hours 30 minutes') AT TIME ZONE 'America/Toronto',
         (date_trunc('day', now() AT TIME ZONE 'America/Toronto') + interval '2 days 20 hours') AT TIME ZONE 'America/Toronto',
         $2, NULL, 'Quartier latin', $3) AS id`,
      [G, title, invitees],
    ),
  );
  return r.id;
}

const respond = (uid: string, plan: string, accept: boolean) =>
  as(uid, () => rows("SELECT public.respond_to_meetup($1, $2)", [plan, accept]));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(FAKE_SUPABASE);
  await db.exec(SETUP_SQL);
  await db.exec(FAKE_PG_NET);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    "RESET ROLE; DELETE FROM auth.users; DELETE FROM public.groups; DELETE FROM net.calls;",
  );
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ($1, 'ali@example.com', '{"full_name": "Ali"}'),
       ($2, 'sam@example.com', '{"full_name": "Sam"}'),
       ($3, 'zoe@example.com', '{"full_name": "Zoé"}'),
       ($4, 'dan@example.com', '{"full_name": "Dan"}')`,
    [A, B, C, D],
  );
  const [g] = await as(A, () => rows<{ id: string }>("SELECT public.create_group('Gang') AS id"));
  G = g.id;
  const [{ invite_code }] = await rows<{ invite_code: string }>(
    "SELECT invite_code FROM groups WHERE id = $1",
    [G],
  );
  for (const u of [B, C, D]) {
    await as(u, () => rows("SELECT public.join_group_by_code($1)", [invite_code]));
  }
  for (const u of [A, B, C, D]) await register(u, TOKEN(u.slice(-1)));
});

describe("push_when_fr", () => {
  it("écrit le moment en français, à l'heure de Montréal (heure avancée comprise)", async () => {
    const r = await rows<{ a: string; b: string; c: string }>(
      `SELECT public.push_when_fr('2027-03-16 22:30+00') AS a,
              public.push_when_fr('2027-01-01 23:00+00') AS b,
              public.push_when_fr('2026-11-01 17:05+00') AS c`,
    );
    expect(r[0]).toEqual({
      a: "mardi 16 mars à 18 h 30",
      b: "vendredi 1er janvier à 18 h",
      c: "dimanche 1er novembre à 12 h 05",
    });
  });
});

describe("Notifications poussées (migration 0023)", () => {
  it("nouveau plan : les invités seulement, pas la personne qui propose", async () => {
    const plan = await propose([B, C]);
    const sent = await calls();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://exp.host/--/api/v2/push/send");
    expect(sent[0].to).toEqual([TOKEN("b"), TOKEN("c")]);
    expect(sent[0].title).toBe("Nouveau plan : Cinéma");
    expect(sent[0].body).toMatch(/^Ali propose \S+ \d+(er)? \S+ à 18 h 30 \(Gang\)\. Tu y vas \?$/);
    expect(sent[0].data).toEqual({ url: "/plans", planId: plan, kind: "proposed" });
    expect(sent[0].channelId).toBe("plans");
  });

  it("tout le groupe invité : tout le monde sauf la personne qui propose", async () => {
    await propose(null);
    const [sent] = await calls();
    expect(sent.to).toEqual([TOKEN("b"), TOKEN("c"), TOKEN("d")]);
  });

  it("une série le dit, et sa répétition est déjà écrite quand la notification part", async () => {
    await as(A, () =>
      rows(
        `SELECT public.propose_recurring_meetup(
           p_group => $1, p_starts_at => now() + interval '2 days', p_ends_at => now() + interval '2 days 1 hour',
           p_title => 'Gym', p_repeat_unit => 'week', p_repeat_every => 1, p_invitees => $2)`,
        [G, [B]],
      ),
    );
    const sent = await calls();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([TOKEN("b")]);
    expect(sent[0].body).toMatch(/^Ali propose une série, dès /);
  });

  it("réponse : la personne qui propose apprend qui accepte ou refuse", async () => {
    const plan = await propose([B, C]);
    await db.exec("DELETE FROM net.calls");
    await respond(B, plan, true);
    await respond(C, plan, false);
    const sent = await calls();
    expect(sent.map((c) => [c.to, c.title])).toEqual([
      [[TOKEN("a")], "Sam a accepté ton plan"],
      [[TOKEN("a")], "Zoé a refusé ton plan"],
    ]);
    expect(sent[0].body).toMatch(/^« Cinéma » · /);
    expect(sent[0].data.kind).toBe("vote");
  });

  it("changer de réponse tout de suite ne renvoie rien (anti-harcèlement), plus tard oui", async () => {
    const plan = await propose([B]);
    await respond(B, plan, true);
    await db.exec("DELETE FROM net.calls");
    await respond(B, plan, false);
    await respond(B, plan, true);
    expect(await calls()).toEqual([]);
    // Réponse précédente il y a 11 minutes (sans le déclencheur qui remet `updated_at` à now()).
    await db.exec("ALTER TABLE plan_votes DISABLE TRIGGER plan_votes_touch");
    await rows(
      "UPDATE plan_votes SET updated_at = now() - interval '11 minutes' WHERE user_id = $1",
      [B],
    );
    await db.exec("ALTER TABLE plan_votes ENABLE TRIGGER plan_votes_touch");
    await db.exec("DELETE FROM net.calls");
    await respond(B, plan, false);
    expect((await calls()).map((c) => c.title)).toEqual(["Sam a refusé ton plan"]);
  });

  it("annulation : les invités qui n'avaient pas refusé, sauf la personne qui annule", async () => {
    const plan = await propose([B, C, D]);
    await respond(B, plan, true);
    await respond(C, plan, false);
    await db.exec("DELETE FROM net.calls");
    await as(A, () => rows("SELECT public.cancel_meetup($1)", [plan]));
    const sent = await calls();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([TOKEN("b"), TOKEN("d")]);
    expect(sent[0].title).toBe("Plan annulé : Cinéma");
    expect(sent[0].body).toMatch(/^Ali a annulé « Cinéma » \(/);
    // Annuler deux fois n'envoie rien de plus.
    await as(A, () => rows("SELECT public.cancel_meetup($1)", [plan]));
    expect(await calls()).toHaveLength(1);
  });

  it("une personne sans téléphone inscrit ne déclenche aucune requête", async () => {
    await as(B, () => rows("DELETE FROM push_tokens"));
    await propose([B]);
    expect(await calls()).toEqual([]);
  });

  it("une requête refusée par le faux pg_net n'empêche pas de proposer", async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(
        url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
        headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
      RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'réseau coupé'; END; $$;`);
    try {
      const plan = await propose([B]);
      expect(await rows("SELECT id FROM meetup_plans WHERE id = $1", [plan])).toHaveLength(1);
    } finally {
      await db.exec("DROP FUNCTION net.http_post(text, jsonb, jsonb, jsonb, integer)");
      await db.exec(
        FAKE_PG_NET.replace("CREATE SCHEMA net;", "").replace(/CREATE TABLE net\.calls[^;]+;/, ""),
      );
    }
  });

  it("personne ne peut appeler send_push ni les fonctions des déclencheurs", async () => {
    await expect(
      as(B, () => rows("SELECT public.send_push(ARRAY[$1]::uuid[], 'x', 'y')", [A])),
    ).rejects.toThrow(/permission/);
    await expect(as(B, () => rows("SELECT public.push_name($1)", [A]))).rejects.toThrow(
      /permission/,
    );
  });
});
