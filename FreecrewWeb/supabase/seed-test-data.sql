-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : jeux de données de test (docs/jeux-de-donnees.md).
--
-- FICHIER GÉNÉRÉ par « npm run db:seed-sql » à partir de src/lib/testdata/freecrew.ts : ne pas
-- le modifier à la main.
--
-- Crée 10 comptes freecrew.<nom>@example.com (ali, sam, maya, leo, nora, zoe, felix,
-- jade, hugo, lina), leurs lieux, horaires, disponibilités, 10 groupes et 3 plans, datés pour la
-- semaine du prochain lundi (aujourd'hui si on est lundi).
--
-- 1. Remplace CHANGE-MOI ci-dessous par le mot de passe des comptes de test (8 caractères, une
--    majuscule, une minuscule, un chiffre).
-- 2. Supabase → SQL Editor → New query → colle tout le fichier → Run.
-- 3. Connecte-toi dans l'app avec freecrew.ali@example.com et ce mot de passe.
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
  ('ali'),
  ('ali.maison'),
  ('ali.cegep'),
  ('ali.cafe'),
  ('ali.lun1'),
  ('ali.lun2'),
  ('ali.mar1'),
  ('ali.mar2'),
  ('ali.mer1'),
  ('ali.mer2'),
  ('ali.jeu1'),
  ('ali.ven1'),
  ('ali.ven2'),
  ('sam'),
  ('sam.maison'),
  ('sam.cegep'),
  ('sam.lun1'),
  ('sam.lun2'),
  ('sam.mar1'),
  ('sam.mar2'),
  ('sam.jeu1'),
  ('sam.jeu2'),
  ('maya'),
  ('maya.maison'),
  ('maya.udem'),
  ('maya.lun1'),
  ('maya.mer1'),
  ('maya.mer2'),
  ('leo'),
  ('leo.maison'),
  ('leo.travail'),
  ('leo.lun1'),
  ('leo.mer1'),
  ('leo.ven1'),
  ('leo.sam1'),
  ('leo.dim1'),
  ('nora'),
  ('nora.maison'),
  ('zoe'),
  ('zoe.biblio'),
  ('zoe.lun1'),
  ('felix'),
  ('felix.maison'),
  ('jade'),
  ('jade.maison'),
  ('hugo'),
  ('hugo.maison'),
  ('hugo.hopital'),
  ('hugo.ven1'),
  ('hugo.sam1'),
  ('lina'),
  ('lina.maison'),
  ('lina.travail'),
  ('lina.ancien-studio'),
  ('lina.sam1'),
  ('lina.jeu1'),
  ('lina.mer1'),
  ('lina.dentiste'),
  ('sam.quart'),
  ('groupe.cegep'),
  ('groupe.ali-maya'),
  ('groupe.ali-leo'),
  ('groupe.loin'),
  ('groupe.quatre'),
  ('groupe.solo'),
  ('groupe.zoe'),
  ('groupe.calmes'),
  ('groupe.lina-nora'),
  ('groupe.nuit'),
  ('plan.souper-cafe'),
  ('plan.marche-parc'),
  ('plan.cinema');

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
  IF EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'freecrew.%@example.com') THEN
    RAISE EXCEPTION 'Les comptes de test existent déjà : lance d''abord supabase/seed-test-data-remove.sql.';
  END IF;
  RAISE NOTICE 'Semaine du lundi %', v_monday;

  -- ─── Comptes (le déclencheur de l'app crée chaque profil) ─────────────────────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('ali'), 'authenticated', 'authenticated',
    'freecrew.ali@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"ali_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('ali'), pg_temp.seed_id('ali')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('ali')::text, 'email', 'freecrew.ali@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('sam'), 'authenticated', 'authenticated',
    'freecrew.sam@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"sam_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('sam'), pg_temp.seed_id('sam')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('sam')::text, 'email', 'freecrew.sam@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('maya'), 'authenticated', 'authenticated',
    'freecrew.maya@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"maya_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('maya'), pg_temp.seed_id('maya')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('maya')::text, 'email', 'freecrew.maya@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('leo'), 'authenticated', 'authenticated',
    'freecrew.leo@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"leo_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('leo'), pg_temp.seed_id('leo')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('leo')::text, 'email', 'freecrew.leo@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('nora'), 'authenticated', 'authenticated',
    'freecrew.nora@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"nora_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('nora'), pg_temp.seed_id('nora')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('nora')::text, 'email', 'freecrew.nora@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('zoe'), 'authenticated', 'authenticated',
    'freecrew.zoe@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"zoe_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('zoe'), pg_temp.seed_id('zoe')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('zoe')::text, 'email', 'freecrew.zoe@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('felix'), 'authenticated', 'authenticated',
    'freecrew.felix@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"felix_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('felix'), pg_temp.seed_id('felix')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('felix')::text, 'email', 'freecrew.felix@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('jade'), 'authenticated', 'authenticated',
    'freecrew.jade@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"jade_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('jade'), pg_temp.seed_id('jade')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('jade')::text, 'email', 'freecrew.jade@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('hugo'), 'authenticated', 'authenticated',
    'freecrew.hugo@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"hugo_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('hugo'), pg_temp.seed_id('hugo')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('hugo')::text, 'email', 'freecrew.hugo@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', pg_temp.seed_id('lina'), 'authenticated', 'authenticated',
    'freecrew.lina@example.com', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"lina_test"}',
    now(), now(), '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), pg_temp.seed_id('lina'), pg_temp.seed_id('lina')::text, 'email',
    json_build_object('sub', pg_temp.seed_id('lina')::text, 'email', 'freecrew.lina@example.com', 'email_verified', true)::jsonb,
    now(), now(), now());

  -- ─── Lieux, profils, horaires, disponibilités ─────────────────────────────────────────
  -- ali
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('ali.maison'), pg_temp.seed_id('ali'), 'Maison d''ali (Vieux-Longueuil)', 45.5369, -73.5107);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('ali.cegep'), pg_temp.seed_id('ali'), 'Cégep Édouard-Montpetit', 45.5364, -73.495);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('ali.cafe'), pg_temp.seed_id('ali'), 'Café rue Saint-Charles', 45.5379, -73.5094);
  UPDATE public.profiles SET display_name = 'ali', travel_mode = 'transit',
    home_place_id = pg_temp.seed_id('ali.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('ali');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.lun1'), pg_temp.seed_id('ali'), 'Chimie générale', pg_temp.seed_id('ali.cegep'), '08:00', '10:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.lun2'), pg_temp.seed_id('ali'), 'Philosophie', pg_temp.seed_id('ali.cegep'), '13:00', '16:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.mar1'), pg_temp.seed_id('ali'), 'Biologie (labo)', pg_temp.seed_id('ali.cegep'), '08:00', '12:00', 2, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.mar2'), pg_temp.seed_id('ali'), 'Français', pg_temp.seed_id('ali.cegep'), '12:45', '15:00', 2, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.mer1'), pg_temp.seed_id('ali'), 'Physique mécanique', pg_temp.seed_id('ali.cegep'), '08:00', '10:00', 3, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.mer2'), pg_temp.seed_id('ali'), 'Anglais', pg_temp.seed_id('ali.cegep'), '13:00', '15:00', 3, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.jeu1'), pg_temp.seed_id('ali'), 'Calcul intégral', pg_temp.seed_id('ali.cegep'), '10:00', '12:00', 4, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.ven1'), pg_temp.seed_id('ali'), 'Éducation physique', pg_temp.seed_id('ali.cegep'), '08:00', '12:00', 5, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('ali.ven2'), pg_temp.seed_id('ali'), 'Calcul différentiel', pg_temp.seed_id('ali.cegep'), '12:00', '15:00', 5, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Sam
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('sam.maison'), pg_temp.seed_id('sam'), 'Maison de Sam (Saint-Lambert)', 45.5007, -73.5076);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('sam.cegep'), pg_temp.seed_id('sam'), 'Cégep Édouard-Montpetit', 45.5364, -73.495);
  UPDATE public.profiles SET display_name = 'Sam', travel_mode = 'bike',
    home_place_id = pg_temp.seed_id('sam.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('sam');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.lun1'), pg_temp.seed_id('sam'), 'Techniques de l''informatique', pg_temp.seed_id('sam.cegep'), '08:00', '11:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.lun2'), pg_temp.seed_id('sam'), 'Mathématiques discrètes', pg_temp.seed_id('sam.cegep'), '13:00', '15:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.mar1'), pg_temp.seed_id('sam'), 'Programmation', pg_temp.seed_id('sam.cegep'), '08:00', '12:00', 2, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.mar2'), pg_temp.seed_id('sam'), 'Bases de données', pg_temp.seed_id('sam.cegep'), '12:45', '17:00', 2, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.jeu1'), pg_temp.seed_id('sam'), 'Programmation web', pg_temp.seed_id('sam.cegep'), '08:00', '11:00', 4, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.jeu2'), pg_temp.seed_id('sam'), 'Labo de réseaux', pg_temp.seed_id('sam.cegep'), '10:00', '12:00', 4, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Maya
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('maya.maison'), pg_temp.seed_id('maya'), 'Maison de Maya (Plateau-Mont-Royal)', 45.5226, -73.5822);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('maya.udem'), pg_temp.seed_id('maya'), 'Université de Montréal', 45.5048, -73.6132);
  UPDATE public.profiles SET display_name = 'Maya', travel_mode = 'transit',
    home_place_id = pg_temp.seed_id('maya.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('maya');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('maya.lun1'), pg_temp.seed_id('maya'), 'Psychologie cognitive', pg_temp.seed_id('maya.udem'), '08:30', '11:30', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('maya.mer1'), pg_temp.seed_id('maya'), 'Méthodes de recherche', pg_temp.seed_id('maya.udem'), '08:00', '10:00', 3, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('maya.mer2'), pg_temp.seed_id('maya'), 'Neurosciences', pg_temp.seed_id('maya.udem'), '13:00', '16:00', 3, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Léo
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('leo.maison'), pg_temp.seed_id('leo'), 'Maison de Léo (Chomedey, Laval)', 45.5412, -73.7458);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('leo.travail'), pg_temp.seed_id('leo'), 'Carrefour Laval', 45.5712, -73.7524);
  UPDATE public.profiles SET display_name = 'Léo', travel_mode = 'car',
    home_place_id = pg_temp.seed_id('leo.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('leo');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('leo.lun1'), pg_temp.seed_id('leo'), 'Travail', pg_temp.seed_id('leo.travail'), '12:00', '20:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('leo.mer1'), pg_temp.seed_id('leo'), 'Travail', pg_temp.seed_id('leo.travail'), '12:00', '20:00', 3, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('leo.ven1'), pg_temp.seed_id('leo'), 'Travail', pg_temp.seed_id('leo.travail'), '15:00', '22:00', 5, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('leo.sam1'), pg_temp.seed_id('leo'), 'Travail', pg_temp.seed_id('leo.travail'), '10:00', '18:00', 6, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('leo.dim1'), pg_temp.seed_id('leo'), 'Travail', pg_temp.seed_id('leo.travail'), '11:00', '17:00', 7, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Nora
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('nora.maison'), pg_temp.seed_id('nora'), 'Maison de Nora (Longueuil, près du cégep)', 45.533, -73.499);
  UPDATE public.profiles SET display_name = 'Nora', travel_mode = 'walk',
    home_place_id = pg_temp.seed_id('nora.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('nora');
  -- Zoé
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('zoe.biblio'), pg_temp.seed_id('zoe'), 'Grande Bibliothèque', 45.5153, -73.5622);
  UPDATE public.profiles SET display_name = 'Zoé', travel_mode = 'transit',
    home_place_id = NULL, onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('zoe');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('zoe.lun1'), pg_temp.seed_id('zoe'), 'Lecture', pg_temp.seed_id('zoe.biblio'), '09:00', '12:00', 1, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Félix
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('felix.maison'), pg_temp.seed_id('felix'), 'Maison de Félix (Sherbrooke)', 45.4042, -71.8929);
  UPDATE public.profiles SET display_name = 'Félix', travel_mode = 'walk',
    home_place_id = pg_temp.seed_id('felix.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('felix');
  -- Jade
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('jade.maison'), pg_temp.seed_id('jade'), 'Maison de Jade (Longueuil)', 45.525, -73.515);
  UPDATE public.profiles SET display_name = 'Jade', travel_mode = 'transit',
    home_place_id = pg_temp.seed_id('jade.maison'), onboarded_at = now(),
    unavailable_before = '10:00', unavailable_after = '20:00',
    max_outings_per_day = 1, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('jade');
  -- Hugo
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('hugo.maison'), pg_temp.seed_id('hugo'), 'Maison de Hugo (Brossard)', 45.458, -73.466);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('hugo.hopital'), pg_temp.seed_id('hugo'), 'Hôpital Charles-LeMoyne', 45.499, -73.487);
  UPDATE public.profiles SET display_name = 'Hugo', travel_mode = 'car',
    home_place_id = pg_temp.seed_id('hugo.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('hugo');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('hugo.ven1'), pg_temp.seed_id('hugo'), 'Quart de nuit', pg_temp.seed_id('hugo.hopital'), '22:00', '24:00', 5, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('hugo.sam1'), pg_temp.seed_id('hugo'), 'Quart de nuit (suite)', pg_temp.seed_id('hugo.hopital'), '00:00', '06:00', 6, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  -- Lina
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('lina.maison'), pg_temp.seed_id('lina'), 'Maison de Lina (Verdun)', 45.459, -73.57);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('lina.travail'), pg_temp.seed_id('lina'), 'Marché Atwater', 45.4805, -73.577);
  INSERT INTO public.places (id, owner_id, name, lat, lng)
  VALUES (pg_temp.seed_id('lina.ancien-studio'), pg_temp.seed_id('lina'), 'Ancien studio (supprimé)', 45.47, -73.58);
  UPDATE public.profiles SET display_name = 'Lina', travel_mode = 'transit',
    home_place_id = pg_temp.seed_id('lina.maison'), onboarded_at = now(),
    unavailable_before = NULL, unavailable_after = NULL,
    max_outings_per_day = NULL, max_outings_per_week = NULL
  WHERE id = pg_temp.seed_id('lina');
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('lina.sam1'), pg_temp.seed_id('lina'), 'Travail', pg_temp.seed_id('lina.travail'), '09:00', '17:00', 6, v_monday - 28, v_monday + 90, NULL, 1, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('lina.jeu1'), pg_temp.seed_id('lina'), 'Club d''échecs', NULL, '18:00', '20:00', 4, v_monday - 28, v_monday + 90, 'week', 2, '{}'::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('lina.mer1'), pg_temp.seed_id('lina'), 'Cours de dessin', pg_temp.seed_id('lina.travail'), '09:00', '12:00', 3, v_monday - 28, v_monday + 90, NULL, 1, ARRAY[v_monday + 2]::date[]);
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('lina.dentiste'), pg_temp.seed_id('lina'), 'Dentiste', pg_temp.seed_id('lina.ancien-studio'), '15:00', '16:00', NULL, v_monday + 1, v_monday + 1 + 360, 'month', 1, '{}'::date[]);
  INSERT INTO public.availability_slots (owner_id, day, start_time, end_time, note)
  VALUES (pg_temp.seed_id('lina'), v_monday + 5, '13:00', '16:00', 'Pause au travail');
  -- Lieu supprimé après coup : ses blocs restent, sans lieu (la maison est utilisée).
  DELETE FROM public.places WHERE id = pg_temp.seed_id('lina.ancien-studio');

  -- ─── Groupes (le déclencheur de l'app ajoute la personne qui crée comme admin) ────────
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.cegep'), 'Pauses du cégep', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.cegep'), pg_temp.seed_id('sam'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.ali-maya'), 'ali et Maya', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.ali-maya'), pg_temp.seed_id('maya'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.ali-leo'), 'ali et Léo', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.ali-leo'), pg_temp.seed_id('leo'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.loin'), 'Trop loin (Félix)', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.loin'), pg_temp.seed_id('felix'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.quatre'), 'Les quatre', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.quatre'), pg_temp.seed_id('sam'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.quatre'), pg_temp.seed_id('maya'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.quatre'), pg_temp.seed_id('leo'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.solo'), 'Juste moi', pg_temp.seed_id('ali'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.zoe'), 'Avec Zoé (sans maison)', pg_temp.seed_id('ali'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.zoe'), pg_temp.seed_id('zoe'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.calmes'), 'Jade et Nora', pg_temp.seed_id('nora'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.calmes'), pg_temp.seed_id('jade'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.lina-nora'), 'Lina et Nora', pg_temp.seed_id('nora'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.lina-nora'), pg_temp.seed_id('lina'));
  INSERT INTO public.groups (id, name, created_by)
  VALUES (pg_temp.seed_id('groupe.nuit'), 'Hugo et Nora', pg_temp.seed_id('nora'));
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (pg_temp.seed_id('groupe.nuit'), pg_temp.seed_id('hugo'));

  -- ─── Plans : proposés et acceptés par les fonctions de l'app ──────────────────────────
  PERFORM pg_temp.seed_as(pg_temp.seed_id('ali'));
  v_plan := public.propose_meetup(pg_temp.seed_id('groupe.cegep'),
    (v_monday + 3 + time '18:00') AT TIME ZONE 'America/Toronto',
    (v_monday + 3 + time '20:00') AT TIME ZONE 'America/Toronto',
    'Souper au café', pg_temp.seed_id('ali.cafe'), '', NULL);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('sam'));
  PERFORM public.respond_to_meetup(v_plan, true);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('nora'));
  v_plan := public.propose_meetup(pg_temp.seed_id('groupe.calmes'),
    (v_monday + 6 + time '14:00') AT TIME ZONE 'America/Toronto',
    (v_monday + 6 + time '16:00') AT TIME ZONE 'America/Toronto',
    'Marche au parc', NULL, 'Parc Michel-Chartrand', NULL);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('jade'));
  PERFORM public.respond_to_meetup(v_plan, true);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('ali'));
  v_plan := public.propose_meetup(pg_temp.seed_id('groupe.quatre'),
    (v_monday + 5 + time '19:00') AT TIME ZONE 'America/Toronto',
    (v_monday + 5 + time '21:30') AT TIME ZONE 'America/Toronto',
    'Cinéma', NULL, 'Cinéma Quartier Latin', NULL);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('maya'));
  PERFORM public.respond_to_meetup(v_plan, true);
  PERFORM pg_temp.seed_as(pg_temp.seed_id('leo'));
  PERFORM public.respond_to_meetup(v_plan, false);

  -- ─── L'horaire change après coup : le souper devient « à revoir » ─────────────────────
  INSERT INTO public.busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday, valid_from, valid_until, repeat_unit, repeat_every, skip_days)
  VALUES (pg_temp.seed_id('sam.quart'), pg_temp.seed_id('sam'), 'Quart de travail', pg_temp.seed_id('sam.maison'), '17:00', '21:00', NULL, v_monday + 3, v_monday + 3, NULL, 1, '{}'::date[]);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$seed$;

COMMIT;
