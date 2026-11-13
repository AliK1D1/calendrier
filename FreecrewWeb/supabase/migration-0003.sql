-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0003_onboarding SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0003_onboarding.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0003_onboarding ───────────────────────────────────────────────────────

ALTER TABLE "profiles" ADD COLUMN "onboarded_at" timestamp with time zone;
ALTER TABLE "places" ADD CONSTRAINT "places_name_length" CHECK (length("places"."name") <= 100);


-- ─── Accueil de première connexion (écrit à la main) ──────────────────────────────────────
-- Enregistre en une seule transaction la maison, le cégep/école (facultatif) et le mode de
-- transport, puis marque le profil comme accueilli. SECURITY INVOKER : la RLS de places et
-- profiles s'applique normalement (on n'écrit que chez soi). Sans effet si l'accueil est déjà
-- fait (un double envoi du formulaire ne crée pas de lieux en double). Tous les paramètres
-- nuls : « passer pour l'instant ».
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  home_name text DEFAULT NULL,
  home_lat double precision DEFAULT NULL,
  home_lng double precision DEFAULT NULL,
  school_name text DEFAULT NULL,
  school_lat double precision DEFAULT NULL,
  school_lng double precision DEFAULT NULL,
  mode public.travel_mode DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  home_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  -- Verrouille la ligne du profil : deux envois simultanés passent l'un après l'autre.
  PERFORM 1 FROM public.profiles WHERE id = uid AND onboarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF home_name IS NOT NULL THEN
    INSERT INTO public.places (owner_id, name, lat, lng)
    VALUES (uid, trim(home_name), home_lat, home_lng)
    RETURNING id INTO home_id;
  END IF;
  IF school_name IS NOT NULL THEN
    INSERT INTO public.places (owner_id, name, lat, lng)
    VALUES (uid, trim(school_name), school_lat, school_lng);
  END IF;
  UPDATE public.profiles
  SET travel_mode = coalesce(mode, travel_mode),
      home_place_id = coalesce(home_id, home_place_id),
      onboarded_at = now()
  WHERE id = uid;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(text, double precision, double precision, text, double precision, double precision, public.travel_mode) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, double precision, double precision, text, double precision, double precision, public.travel_mode) TO authenticated;

COMMIT;
