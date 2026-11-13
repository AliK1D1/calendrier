-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0017_subscribed_calendars SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0017_subscribed_calendars.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0017_subscribed_calendars ─────────────────────────────────────────────

ALTER TYPE "public"."block_source" ADD VALUE 'subscription';
CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"outlook_calendar_id" text,
	"counts_as_busy" boolean NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text DEFAULT '' NOT NULL,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_subscriptions_kind" CHECK ("calendar_subscriptions"."kind" in ('ics', 'outlook')),
	CONSTRAINT "calendar_subscriptions_shape" CHECK (("calendar_subscriptions"."kind" = 'ics' and "calendar_subscriptions"."url" is not null and "calendar_subscriptions"."outlook_calendar_id" is null) or ("calendar_subscriptions"."kind" = 'outlook' and "calendar_subscriptions"."url" is null and "calendar_subscriptions"."outlook_calendar_id" is not null)),
	CONSTRAINT "calendar_subscriptions_url_format" CHECK ("calendar_subscriptions"."url" is null or (length("calendar_subscriptions"."url") <= 2000 and "calendar_subscriptions"."url" ~ '^https?://')),
	CONSTRAINT "calendar_subscriptions_outlook_id_length" CHECK ("calendar_subscriptions"."outlook_calendar_id" is null or length("calendar_subscriptions"."outlook_calendar_id") between 1 and 1024),
	CONSTRAINT "calendar_subscriptions_name_length" CHECK (length("calendar_subscriptions"."name") between 1 and 100),
	CONSTRAINT "calendar_subscriptions_error_length" CHECK (length("calendar_subscriptions"."last_sync_error") <= 300)
);

CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"weekday" smallint,
	"valid_from" date NOT NULL,
	"valid_until" date,
	CONSTRAINT "subscription_events_time_order" CHECK ("subscription_events"."end_time" > "subscription_events"."start_time"),
	CONSTRAINT "subscription_events_weekday_range" CHECK ("subscription_events"."weekday" is null or "subscription_events"."weekday" between 1 and 7),
	CONSTRAINT "subscription_events_validity" CHECK ("subscription_events"."valid_until" is null or ("subscription_events"."valid_until" >= "subscription_events"."valid_from" and "subscription_events"."valid_until" - "subscription_events"."valid_from" < 366)),
	CONSTRAINT "subscription_events_one_off" CHECK ("subscription_events"."weekday" is not null or "subscription_events"."valid_until" is null or "subscription_events"."valid_until" = "subscription_events"."valid_from"),
	CONSTRAINT "subscription_events_title_length" CHECK (length("subscription_events"."title") <= 100)
);

ALTER TABLE "busy_blocks" ADD COLUMN "subscription_id" uuid;
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_calendar_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."calendar_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "calendar_subscriptions_owner_idx" ON "calendar_subscriptions" USING btree ("owner_id");
CREATE UNIQUE INDEX "calendar_subscriptions_owner_url_key" ON "calendar_subscriptions" USING btree ("owner_id","url");
CREATE UNIQUE INDEX "calendar_subscriptions_owner_outlook_key" ON "calendar_subscriptions" USING btree ("owner_id","outlook_calendar_id");
CREATE INDEX "subscription_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id");
CREATE INDEX "subscription_events_owner_idx" ON "subscription_events" USING btree ("owner_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_id_calendar_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."calendar_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "busy_blocks_subscription_idx" ON "busy_blocks" USING btree ("subscription_id");
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_link" CHECK (("busy_blocks"."source"::text = 'subscription') = ("busy_blocks"."subscription_id" is not null));
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_subscription_no_place" CHECK ("busy_blocks"."source"::text <> 'subscription' or "busy_blocks"."place_id" is null);

-- ─── Story 3 : calendriers en ligne abonnés ─────────────────────────────────────────────
-- Un calendrier abonné (lien iCalendar ou calendrier du compte Outlook) et ses événements ne
-- sont visibles que par la personne. Si elle a choisi « compte comme occupé », les
-- événements sont aussi copiés dans busy_blocks (source 'subscription') : les membres de ses
-- groupes n'y voient que « Occupé ». Sinon, ils restent dans subscription_events, affichés
-- dans son horaire seulement, et ne bloquent rien.
--
-- Personne ne modifie un abonnement directement : on l'ajoute (INSERT), on le retire
-- (DELETE : ses événements et ses blocs partent avec lui), et tout le reste passe par les
-- fonctions ci-dessous (synchro, « compte comme occupé »). L'adresse n'est lue que par le
-- serveur de l'app, qui la vérifie avant chaque téléchargement (pas d'adresse interne).
REVOKE ALL ON public.calendar_subscriptions, public.subscription_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.calendar_subscriptions TO authenticated;

GRANT INSERT (owner_id, kind, name, url, outlook_calendar_id, counts_as_busy)
  ON public.calendar_subscriptions TO authenticated;

GRANT SELECT ON public.subscription_events TO authenticated;

ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_subscriptions_select ON public.calendar_subscriptions FOR SELECT
  TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE POLICY calendar_subscriptions_insert ON public.calendar_subscriptions FOR INSERT
  TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY calendar_subscriptions_delete ON public.calendar_subscriptions FOR DELETE
  TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE POLICY subscription_events_select ON public.subscription_events FOR SELECT
  TO authenticated USING (owner_id = (SELECT auth.uid()));


-- Au plus 10 calendriers abonnés par personne.
CREATE OR REPLACE FUNCTION public.enforce_subscription_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.calendar_subscriptions s WHERE s.owner_id = NEW.owner_id) >= 10 THEN
    RAISE EXCEPTION 'Trop de calendriers abonnés (10 au maximum)' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_subscriptions_limit
  BEFORE INSERT ON public.calendar_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();

REVOKE EXECUTE ON FUNCTION public.enforce_subscription_limit() FROM PUBLIC, anon, authenticated;


-- ─── Blocs d'abonnement : lecture seule pour la personne (comme Outlook) ──────────────────
-- Ils ne s'écrivent que par les fonctions ci-dessous et partent avec leur abonnement.
DROP POLICY busy_blocks_update ON public.busy_blocks;

CREATE POLICY busy_blocks_update ON public.busy_blocks FOR UPDATE TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND source::text NOT IN ('outlook', 'subscription')
  )
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
  USING (
    owner_id = (SELECT auth.uid())
    AND meetup_plan_id IS NULL
    AND source::text NOT IN ('outlook', 'subscription')
  );

DROP POLICY busy_blocks_insert ON public.busy_blocks;

CREATE POLICY busy_blocks_insert ON public.busy_blocks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND source::text NOT IN ('outlook', 'subscription')
    AND (
      place_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.places p
        WHERE p.id = place_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );


-- ─── Fonctions ─────────────────────────────────────────────────────────────────────────────
-- Copie (ou retire) les événements d'un abonnement dans busy_blocks selon counts_as_busy.
-- Interne : appelée seulement par les fonctions ci-dessous.
CREATE OR REPLACE FUNCTION public.mirror_subscription_blocks(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.busy_blocks b WHERE b.subscription_id = p_id;
  INSERT INTO public.busy_blocks (owner_id, title, place_id, start_time, end_time, weekday,
    valid_from, valid_until, source, subscription_id)
  SELECT e.owner_id, e.title, NULL, e.start_time, e.end_time, e.weekday, e.valid_from,
    e.valid_until, 'subscription'::public.block_source, e.subscription_id
  FROM public.subscription_events e
  JOIN public.calendar_subscriptions s ON s.id = e.subscription_id
  WHERE e.subscription_id = p_id AND s.counts_as_busy
  ORDER BY e.valid_from, e.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mirror_subscription_blocks(uuid) FROM PUBLIC, anon, authenticated;


-- Réserve la synchronisation des abonnements de la personne connectée qui sont dus : dernier
-- essai il y a au moins `p_min_minutes` (360 automatique, 2 bouton ; au moins 1), et pas de
-- synchro en cours depuis moins de 2 min. `p_id` : un seul abonnement (bouton). Au plus 5 à
-- la fois. Renvoie un tableau JSON [{id, kind, url, outlook_calendar_id}] (vide : rien à faire).
CREATE OR REPLACE FUNCTION public.claim_subscription_syncs(p_min_minutes integer, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  WITH due AS (
    SELECT s.id FROM public.calendar_subscriptions s
    WHERE s.owner_id = uid
      AND (p_id IS NULL OR s.id = p_id)
      AND (s.sync_started_at IS NULL OR s.sync_started_at <= now() - interval '2 minutes')
      AND (s.last_attempt_at IS NULL OR s.last_attempt_at
        <= now() - make_interval(mins => greatest(coalesce(p_min_minutes, 360), 1)))
    ORDER BY s.last_attempt_at NULLS FIRST, s.created_at
    LIMIT 5
    FOR UPDATE
  ), claimed AS (
    UPDATE public.calendar_subscriptions s
      SET sync_started_at = now(), last_attempt_at = now()
      FROM due WHERE s.id = due.id
      RETURNING s.id, s.kind, s.url, s.outlook_calendar_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'url', c.url,
      'outlook_calendar_id', c.outlook_calendar_id)), '[]'::jsonb)
    INTO result FROM claimed c;
  RETURN result;
END;
$$;


-- Remplace les événements d'un abonnement de la personne par `p_events` (tableau JSON de
-- {"title", "start": "HH:mm", "end": "HH:mm", "weekday": 1-7 ou null, "from": "yyyy-MM-dd",
-- "until": "yyyy-MM-dd" ou null}), en une transaction : si un événement est refusé (ou si la
-- limite de 1000 blocs est dépassée), l'ancienne version reste. Note la synchro réussie.
CREATE OR REPLACE FUNCTION public.replace_subscription_events(p_id uuid, p_events jsonb)
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
  PERFORM 1 FROM public.calendar_subscriptions s
    WHERE s.id = p_id AND s.owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendrier abonné introuvable.' USING ERRCODE = '42501';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'Événements invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_events) > 300 THEN
    RAISE EXCEPTION 'Trop d''événements dans ce calendrier (300 au maximum)' USING ERRCODE = '54000';
  END IF;
  DELETE FROM public.busy_blocks b WHERE b.subscription_id = p_id;
  DELETE FROM public.subscription_events e WHERE e.subscription_id = p_id;
  INSERT INTO public.subscription_events (subscription_id, owner_id, title, start_time,
    end_time, weekday, valid_from, valid_until)
  SELECT p_id, uid, left(coalesce(e->>'title', ''), 100), (e->>'start')::time,
    (e->>'end')::time, (e->>'weekday')::smallint, (e->>'from')::date, (e->>'until')::date
  FROM jsonb_array_elements(p_events) AS e;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.mirror_subscription_blocks(p_id);
  UPDATE public.calendar_subscriptions s
    SET last_synced_at = now(), last_sync_error = '', sync_started_at = NULL,
      last_attempt_at = coalesce(s.last_attempt_at, now())
    WHERE s.id = p_id;
  RETURN n;
END;
$$;


-- Synchro ratée (lien brisé, calendrier illisible…) : on garde la dernière version connue et
-- on note l'erreur, affichée à la personne.
CREATE OR REPLACE FUNCTION public.fail_subscription_sync(p_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_subscriptions s
    SET last_sync_error = left(coalesce(nullif(p_error, ''), 'Synchronisation impossible.'), 300),
      sync_started_at = NULL
    WHERE s.id = p_id AND s.owner_id = uid;
END;
$$;


-- « Compte comme occupé » : change le choix et ajoute ou retire tout de suite les blocs.
CREATE OR REPLACE FUNCTION public.set_subscription_busy(p_id uuid, p_busy boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.' USING ERRCODE = '42501';
  END IF;
  IF p_busy IS NULL THEN
    RAISE EXCEPTION 'Choix invalide.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.calendar_subscriptions s SET counts_as_busy = p_busy
    WHERE s.id = p_id AND s.owner_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendrier abonné introuvable.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.mirror_subscription_blocks(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_subscription_syncs(integer, uuid),
  public.replace_subscription_events(uuid, jsonb), public.fail_subscription_sync(uuid, text),
  public.set_subscription_busy(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_subscription_syncs(integer, uuid),
  public.replace_subscription_events(uuid, jsonb), public.fail_subscription_sync(uuid, text),
  public.set_subscription_busy(uuid, boolean) TO authenticated;


-- Déconnecter Outlook retire aussi les calendriers abonnés lus par Outlook (et leurs blocs).
-- Le reste est inchangé (migration 0014).
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
  DELETE FROM public.calendar_subscriptions s WHERE s.owner_id = uid AND s.kind = 'outlook';
  DELETE FROM public.outlook_connections c WHERE c.owner_id = uid;
END;
$$;


-- ─── Confidentialité : un bloc d'abonnement est toujours « Occupé » pour les autres ───────
-- Même si la personne montre ses titres. Le reste est inchangé (migration 0015).
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
  valid_until date,
  repeat_unit text,
  repeat_every smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    b.id,
    b.owner_id,
    CASE WHEN b.owner_id = (SELECT auth.uid())
        OR NOT (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text IN ('study', 'outlook', 'subscription')
        OR coalesce(mp.group_id <> gid, false)),
    b.place_id,
    b.start_time,
    b.end_time,
    b.weekday,
    b.valid_from,
    b.valid_until,
    b.repeat_unit,
    b.repeat_every
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
