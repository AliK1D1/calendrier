// Génère, à partir des jeux de données (src/lib/testdata/freecrew.ts), deux fichiers SQL à
// coller dans le SQL Editor de Supabase :
// - supabase/seed-test-data.sql : crée les 10 comptes de test et leurs lieux, horaires,
//   disponibilités, groupes et plans (semaine du prochain lundi, calculée au moment du Run) ;
// - supabase/seed-test-data-remove.sql : efface tout (les comptes freecrew.*@example.com).
// Usage : npm run db:seed-sql
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GROUPS, LATE_BLOCKS, PEOPLE, PLANS, dayOffset } from "../src/lib/testdata/freecrew.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Domaine des courriels de test : sert aussi à les retrouver pour les effacer. */
export const SEED_EMAIL_DOMAIN = "example.com";

/** Texte SQL entre apostrophes. */
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const qn = (s) => (s === null || s === undefined ? "NULL" : q(s));
/** Identifiant généré pour une clé des données. */
const id = (key) => `pg_temp.seed_id(${q(key)})`;
const idn = (key) => (key === null ? "NULL" : id(key));
const day = (d, week = 0) => `v_monday + ${dayOffset(d) + 7 * week}`;

function blockSql(owner, b) {
  const cols = {
    id: id(b.key),
    owner_id: id(owner),
    title: q(b.title),
    place_id: idn(b.place),
    start_time: q(b.start),
    end_time: q(b.end),
    weekday: "NULL",
    valid_from: "NULL",
    valid_until: "NULL",
    repeat_unit: "NULL",
    repeat_every: "1",
    skip_days: "'{}'::date[]",
  };
  if (b.kind === "once") {
    cols.valid_from = cols.valid_until = day(b.day, b.week ?? 0);
  } else if (b.kind === "monthly") {
    cols.valid_from = day(b.day);
    cols.valid_until = `${day(b.day)} + 360`;
    cols.repeat_unit = q("month");
  } else {
    const every = b.every ?? 1;
    cols.weekday = String(dayOffset(b.day) + 1);
    cols.valid_from = "v_monday - 28";
    cols.valid_until = "v_monday + 90";
    if (every > 1) {
      cols.repeat_unit = q("week");
      cols.repeat_every = String(every);
    }
    if (b.skip?.length) cols.skip_days = `ARRAY[${b.skip.map((d) => day(d)).join(", ")}]::date[]`;
  }
  return `  INSERT INTO public.busy_blocks (${Object.keys(cols).join(", ")})
  VALUES (${Object.values(cols).join(", ")});`;
}

/** Contenu de supabase/seed-test-data.sql. */
export function buildSeedSql() {
  const keys = [
    ...PEOPLE.flatMap((p) => [
      p.key,
      ...p.places.map((pl) => pl.id),
      ...(p.deletedPlaces ?? []).map((pl) => pl.id),
      ...p.blocks.map((b) => b.key),
    ]),
    ...LATE_BLOCKS.map((l) => l.block.key),
    ...GROUPS.map((g) => `groupe.${g.key}`),
    ...PLANS.map((p) => `plan.${p.key}`),
  ];
  const out = [];
  const w = (s = "") => out.push(s);

  w(`-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : jeux de données de test (docs/jeux-de-donnees.md).
--
-- FICHIER GÉNÉRÉ par « npm run db:seed-sql » à partir de src/lib/testdata/freecrew.ts : ne pas
-- le modifier à la main.
--
-- Crée 10 comptes freecrew.<nom>@${SEED_EMAIL_DOMAIN} (ali, sam, maya, leo, nora, zoe, felix,
-- jade, hugo, lina), leurs lieux, horaires, disponibilités, 10 groupes et 3 plans, datés pour la
-- semaine du prochain lundi (aujourd'hui si on est lundi).
--
-- 1. Remplace CHANGE-MOI ci-dessous par le mot de passe des comptes de test (8 caractères, une
--    majuscule, une minuscule, un chiffre).
-- 2. Supabase → SQL Editor → New query → colle tout le fichier → Run.
-- 3. Connecte-toi dans l'app avec freecrew.ali@${SEED_EMAIL_DOMAIN} et ce mot de passe.
--
-- Ces comptes ne sont dans aucun groupe de tes vrais amis. Pour tout effacer (et pour
-- recommencer une autre semaine) : supabase/seed-test-data-remove.sql.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est créé.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE seed_settings ON COMMIT DROP AS
SELECT 'CHANGE-MOI'::text AS password;

CREATE TEMP TABLE seed_ids (key text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid())
  ON COMMIT DROP;
INSERT INTO seed_ids (key) VALUES
${keys.map((k) => `  (${q(k)})`).join(",\n")};

CREATE OR REPLACE FUNCTION pg_temp.seed_id(k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM seed_ids WHERE key = k
$$;

-- Agit au nom d'un compte : les fonctions de l'app (auth.uid()) le voient comme connecté.
CREATE OR REPLACE FUNCTION pg_temp.seed_as(uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

DO $seed$
DECLARE
  v_password text := (SELECT password FROM seed_settings);
  v_today date := (now() AT TIME ZONE 'America/Toronto')::date;
  v_monday date := v_today + ((8 - extract(isodow FROM v_today)::int) % 7);
  v_plan uuid;
BEGIN
  IF v_password = 'CHANGE-MOI' OR length(v_password) < 8 OR v_password !~ '[A-Z]'
     OR v_password !~ '[a-z]' OR v_password !~ '[0-9]' THEN
    RAISE EXCEPTION 'Remplace CHANGE-MOI (en haut du fichier) par un mot de passe : 8 caractères, une majuscule, une minuscule, un chiffre.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'freecrew.%@${SEED_EMAIL_DOMAIN}') THEN
    RAISE EXCEPTION 'Les comptes de test existent déjà : lance d''abord supabase/seed-test-data-remove.sql.';
  END IF;
  RAISE NOTICE 'Semaine du lundi %', v_monday;

  -- ─── Comptes (le déclencheur de l'app crée chaque profil) ─────────────────────────────`);
  for (const p of PEOPLE) {
    const email = `freecrew.${p.key}@${SEED_EMAIL_DOMAIN}`;
    w(`  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', ${id(p.key)}, 'authenticated', 'authenticated',
    ${q(email)}, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', ${q(JSON.stringify({ username: p.username }))},
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), ${id(p.key)}, ${id(p.key)}::text, 'email',
    json_build_object('sub', ${id(p.key)}::text, 'email', ${q(email)}, 'email_verified', true)::jsonb,
    now(), now(), now());`);
  }

  w(`
  -- ─── Lieux, profils, horaires, disponibilités ─────────────────────────────────────────`);
  for (const p of PEOPLE) {
    w(`  -- ${p.name}`);
    for (const pl of [...p.places, ...(p.deletedPlaces ?? [])]) {
      w(`  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (${id(pl.id)}, ${id(p.key)}, ${q(pl.name)}, ${pl.lat}, ${pl.lng});`);
    }
    w(`  UPDATE public.profiles SET display_name = ${q(p.name)}, travel_mode = ${q(p.travelMode)},
    home_place_id = ${idn(p.home)}, onboarded_at = now(),
    unavailable_before = ${qn(p.quiet?.before)}, unavailable_after = ${qn(p.quiet?.after)},
    max_outings_per_day = ${p.outings?.perDay ?? "NULL"}, max_outings_per_week = ${p.outings?.perWeek ?? "NULL"}
  WHERE id = ${id(p.key)};`);
    for (const b of p.blocks) w(blockSql(p.key, b));
    for (const a of p.availabilities ?? []) {
      w(`  INSERT INTO public.availability_slots (owner_id, day, start_time, end_time, note)
  VALUES (${id(p.key)}, ${day(a.day)}, ${q(a.start)}, ${q(a.end)}, ${q(a.note)});`);
    }
    for (const pl of p.deletedPlaces ?? []) {
      w(`  -- Lieu supprimé après coup : ses blocs restent, sans lieu (la maison est utilisée).
  DELETE FROM public.places WHERE id = ${id(pl.id)};`);
    }
  }

  w(`
  -- ─── Groupes (le déclencheur de l'app ajoute la personne qui crée comme admin) ────────`);
  for (const g of GROUPS) {
    w(`  INSERT INTO public.groups (id, name, created_by)
  VALUES (${id(`groupe.${g.key}`)}, ${q(g.name)}, ${id(g.creator)});`);
    for (const m of g.members) {
      w(`  INSERT INTO public.group_members (group_id, user_id)
  VALUES (${id(`groupe.${g.key}`)}, ${id(m)});`);
    }
  }

  w(`
  -- ─── Plans : proposés et acceptés par les fonctions de l'app ──────────────────────────`);
  for (const p of PLANS) {
    w(`  PERFORM pg_temp.seed_as(${id(p.proposer)});
  v_plan := public.propose_meetup(${id(`groupe.${p.group}`)},
    (${day(p.day)} + time ${q(p.start)}) AT TIME ZONE 'America/Toronto',
    (${day(p.day)} + time ${q(p.end)}) AT TIME ZONE 'America/Toronto',
    ${q(p.title)}, ${idn(p.place)}, ${q(p.location)}, NULL);`);
    for (const k of p.accepted) {
      w(`  PERFORM pg_temp.seed_as(${id(k)});
  PERFORM public.respond_to_meetup(v_plan, true);`);
    }
    for (const k of p.declined) {
      w(`  PERFORM pg_temp.seed_as(${id(k)});
  PERFORM public.respond_to_meetup(v_plan, false);`);
    }
  }

  w(`
  -- ─── L'horaire change après coup : le souper devient « à revoir » ─────────────────────`);
  for (const l of LATE_BLOCKS) w(blockSql(l.person, l.block));

  w(`
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$seed$;

COMMIT;
`);
  return out.join("\n");
}

/** Contenu de supabase/seed-test-data-remove.sql. */
export function buildRemoveSql() {
  return `-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : efface les jeux de données de test (créés par supabase/seed-test-data.sql).
--
-- FICHIER GÉNÉRÉ par « npm run db:seed-sql » : ne pas le modifier à la main.
--
-- Supprime seulement les comptes freecrew.<nom>@${SEED_EMAIL_DOMAIN}. Leurs profils, lieux,
-- horaires, groupes et plans partent avec eux (suppression en cascade). Rien d'autre n'est
-- touché.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM auth.users
WHERE email IN (
${PEOPLE.map((p) => `  ${q(`freecrew.${p.key}@${SEED_EMAIL_DOMAIN}`)}`).join(",\n")}
);

COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(join(ROOT, "supabase/seed-test-data.sql"), buildSeedSql());
  writeFileSync(join(ROOT, "supabase/seed-test-data-remove.sql"), buildRemoveSql());
  console.log("supabase/seed-test-data.sql et supabase/seed-test-data-remove.sql écrits.");
}
