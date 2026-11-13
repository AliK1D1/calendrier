-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0014_outlook_connector SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0014_outlook_connector.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0014_outlook_connector ────────────────────────────────────────────────

ALTER TYPE "public"."block_source" ADD VALUE 'outlook';
CREATE TABLE "outlook_connections" (
	"owner_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"account_email" text DEFAULT '' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"calendar_id" text,
	"calendar_name" text DEFAULT '' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text DEFAULT '' NOT NULL,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlook_connections_email_length" CHECK (length("outlook_connections"."account_email") <= 320),
	CONSTRAINT "outlook_connections_token_length" CHECK (length("outlook_connections"."refresh_token_enc") between 1 and 16000),
	CONSTRAINT "outlook_connections_calendar_id_length" CHECK ("outlook_connections"."calendar_id" is null or length("outlook_connections"."calendar_id") between 1 and 1024),
	CONSTRAINT "outlook_connections_calendar_name_length" CHECK (length("outlook_connections"."calendar_name") <= 255),
	CONSTRAINT "outlook_connections_error_length" CHECK (length("outlook_connections"."last_sync_error") <= 300)
);

ALTER TABLE "outlook_connections" ADD CONSTRAINT "outlook_connections_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_outlook_one_off" CHECK ("busy_blocks"."source"::text <> 'outlook' or ("busy_blocks"."weekday" is null and "busy_blocks"."place_id" is null));

-- ─── Connecteur Outlook : droits et RLS ───────────────────────────────────────────────────
-- Une connexion Outlook n'est visible et modifiable que par la personne elle-même. Les membres
-- de ses groupes ne voient JAMAIS cette table : seulement les blocs « Occupé » qui en sont
-- tirés (busy_blocks, source 'outlook'). Le jeton est chiffré par le serveur de l'app (clé
-- OUTLOOK_TOKEN_KEY, jamais dans la BD) : même lu par l'API REST, il est inutilisable.
REVOKE ALL ON public.outlook_connections FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.outlook_connections TO authenticated;

GRANT INSERT (owner_id, account_email, refresh_token_enc, calendar_id, calendar_name)
  ON public.outlook_connections TO authenticated;

GRANT UPDATE (account_email, refresh_token_enc, calendar_id, calendar_name, last_attempt_at,
  last_synced_at, last_sync_error, sync_started_at) ON public.outlook_connections TO authenticated;

ALTER TABLE public.outlook_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY outlook_connections_select ON public.outlook_connections FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_insert ON public.outlook_connections FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_update ON public.outlook_connections FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY outlook_connections_delete ON public.outlook_connections FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- ─── Blocs Outlook : lecture seule pour la personne ───────────────────────────────────────
-- Les blocs 'outlook' ne s'écrivent que par replace_outlook_blocks et ne se retirent que par
-- elle ou disconnect_outlook : la personne ne peut pas les modifier ni les supprimer un à un
-- (ils reviendraient à la synchro suivante). Comparaison en texte : la valeur 'outlook' est
-- ajoutée dans la même transaction.
DROP POLICY busy_blocks_update ON public.busy_blocks;

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL AND source::text <> 'outlook')
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY busy_blocks_delete ON public.busy_blocks;

CREATE POLICY busy_blocks_delete ON public.busy_blocks FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND meetup_plan_id IS NULL AND source::text <> 'outlook');

-- On ne peut pas non plus créer un bloc 'outlook' à la main (seulement par la fonction).
DROP POLICY busy_blocks_insert ON public.busy_blocks;

CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND source::text <> 'outlook'
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );


-- ─── Fonctions ─────────────────────────────────────────────────────────────────────────────
-- Remplace TOUS les blocs Outlook de la personne connectée par `p_blocks` (tableau JSON de
-- {"day": "yyyy-MM-dd", "start": "HH:mm", "end": "HH:mm"}), en une transaction : si un bloc
-- est refusé, les anciens restent. Titre fixe « Outlook », aucun lieu : on ne garde jamais le
-- titre, le lieu ni les participants des événements. Les contraintes de busy_blocks et la
-- limite de 1000 blocs (trigger busy_blocks_row_limit) s'appliquent.
CREATE OR REPLACE FUNCTION public.replace_outlook_blocks(p_blocks jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outlook_connections c WHERE c.owner_id = uid) THEN
    RAISE EXCEPTION 'Outlook n''est pas connecté.' USING ERRCODE = '42501';
  END IF;
  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN
    RAISE EXCEPTION 'Blocs Outlook invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_blocks) > 500 THEN
    RAISE EXCEPTION 'Trop d''événements Outlook (500 au maximum)' USING ERRCODE = '54000';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.owner_id = uid AND b.source::text = 'outlook';
  INSERT INTO public.busy_blocks (owner_id, title, place_id, start_time, end_time, weekday,
    valid_from, valid_until, source)
  SELECT uid, 'Outlook', NULL, (e->>'start')::time, (e->>'end')::time, NULL,
    (e->>'day')::date, NULL, 'outlook'::public.block_source
  FROM jsonb_array_elements(p_blocks) AS e;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Déconnexion : retire les blocs Outlook ET la connexion (le jeton chiffré), en une fois.
CREATE OR REPLACE FUNCTION public.disconnect_outlook()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.owner_id = uid AND b.source::text = 'outlook';
  DELETE FROM public.outlook_connections c WHERE c.owner_id = uid;
END;
$$;

-- Réserve une synchronisation pour la personne connectée et renvoie de quoi la faire.
-- `p_min_minutes` : délai minimal depuis le dernier essai (15 automatique, 1 bouton), au
-- moins 1. Statut : 'none' (pas connecté), 'recent' (trop tôt), 'busy' (une autre synchro
-- est en cours depuis moins de 2 min) ou 'ok' (réservée : le verrou est posé).
CREATE OR REPLACE FUNCTION public.claim_outlook_sync(p_min_minutes integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  c public.outlook_connections;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.outlook_connections oc WHERE oc.owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  IF c.sync_started_at IS NOT NULL AND c.sync_started_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  IF c.last_attempt_at IS NOT NULL
    AND c.last_attempt_at > now() - make_interval(mins => greatest(coalesce(p_min_minutes, 15), 1)) THEN
    RETURN jsonb_build_object('status', 'recent');
  END IF;
  UPDATE public.outlook_connections oc
    SET sync_started_at = now(), last_attempt_at = now()
    WHERE oc.owner_id = uid;
  RETURN jsonb_build_object('status', 'ok', 'refresh_token_enc', c.refresh_token_enc,
    'calendar_id', c.calendar_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_outlook_blocks(jsonb), public.disconnect_outlook(),
  public.claim_outlook_sync(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.replace_outlook_blocks(jsonb), public.disconnect_outlook(),
  public.claim_outlook_sync(integer) TO authenticated;


-- ─── Confidentialité : un bloc Outlook est toujours « Occupé » pour les autres ────────────
-- Même si la personne montre ses titres (hide_block_titles faux). Le reste est inchangé
-- (migration 0011).
CREATE OR REPLACE FUNCTION public.group_busy_blocks(gid uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  title text,
  title_hidden boolean,
  place_id uuid,
  start_time time,
  end_time time,
  weekday smallint,
  valid_from date,
  valid_until date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook')
        OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until
  FROM public.busy_blocks b
  JOIN public.group_members m ON m.user_id = b.owner_id AND m.group_id = gid
  JOIN public.profiles p ON p.id = b.owner_id
  LEFT JOIN public.meetup_plans mp ON mp.id = b.meetup_plan_id
  WHERE public.is_group_member(gid)
  ORDER BY b.owner_id, b.weekday NULLS LAST, b.valid_from, b.start_time;
$$;

REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;

COMMIT;
