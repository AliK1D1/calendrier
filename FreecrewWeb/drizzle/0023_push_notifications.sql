CREATE TABLE "push_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid DEFAULT auth.uid() NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_platform" CHECK ("push_tokens"."platform" in ('ios', 'android')),
	CONSTRAINT "push_tokens_format" CHECK (length("push_tokens"."token") <= 200 and "push_tokens"."token" ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$')
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint

-- ─── Notifications poussées de l'app mobile ─────────────────────────────────────────────
-- Chaque téléphone inscrit garde un jeton Expo dans push_tokens. La personne voit et retire
-- ses propres jetons ; elle en ajoute un seulement par register_push_token (un téléphone passe
-- au nouveau compte quand on change de compte sur l'app).
--
-- Les notifications partent de la BD elle-même, quoi que la personne utilise (site ou app) :
--   * un plan est proposé : les invités (sauf la personne qui propose) ;
--   * un invité accepte ou refuse : la personne qui a proposé ;
--   * un plan est annulé (ou une série arrêtée) : les invités qui n'avaient pas refusé.
-- L'envoi passe par l'extension pg_net de Supabase (requête HTTP vers le service Expo, faite
-- APRÈS la fin de la transaction, et jamais si elle échoue). Sans pg_net, rien ne part et
-- rien ne casse. Un envoi raté n'empêche jamais de proposer, répondre ou annuler.
REVOKE ALL ON public.push_tokens FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, DELETE ON public.push_tokens TO authenticated;
--> statement-breakpoint
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_tokens_select ON public.push_tokens FOR SELECT
  TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY push_tokens_delete ON public.push_tokens FOR DELETE
  TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint

-- pg_net : déjà offert par Supabase (Database → Extensions). Ailleurs (tests), on continue
-- sans lui.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Extension pg_net absente : aucune notification poussée ne partira (%).', SQLERRM;
END;
$$;
--> statement-breakpoint

-- ─── Inscrire ce téléphone ─────────────────────────────────────────────────────────────────
-- Au plus 10 téléphones par personne : les plus anciens partent.
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(p_token) > 200
    OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' THEN
    RAISE EXCEPTION 'Jeton de notification invalide.' USING ERRCODE = '22023';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Appareil invalide.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_tokens (token, user_id, platform)
  VALUES (p_token, uid, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now();
  DELETE FROM public.push_tokens t
  WHERE t.user_id = uid AND t.token IN (
    SELECT o.token FROM public.push_tokens o
    WHERE o.user_id = uid
    ORDER BY o.updated_at DESC, o.token
    OFFSET 10
  );
END;
$$;
--> statement-breakpoint

-- ─── « jeudi 14 novembre à 18 h 30 » (heure de Montréal) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_when_fr(p_at timestamptz)
RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT (ARRAY['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
      'dimanche'])[extract(isodow FROM l)::int]
    || ' ' || extract(day FROM l)::int
    || CASE WHEN extract(day FROM l) = 1 THEN 'er' ELSE '' END
    || ' ' || (ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
      'septembre', 'octobre', 'novembre', 'décembre'])[extract(month FROM l)::int]
    || ' à ' || extract(hour FROM l)::int || ' h'
    || CASE WHEN extract(minute FROM l) = 0 THEN '' ELSE ' ' || to_char(l, 'MI') END
  FROM (SELECT p_at AT TIME ZONE 'America/Toronto' AS l) s;
$$;
--> statement-breakpoint

-- Nom affiché d'une personne (« Quelqu'un » s'il est vide).
CREATE OR REPLACE FUNCTION public.push_name(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT nullif(trim(p.display_name), '') FROM public.profiles p WHERE p.id = p_user),
    'Quelqu''un');
$$;
--> statement-breakpoint

-- ─── Envoyer ───────────────────────────────────────────────────────────────────────────────
-- Une requête au service Expo par tranche de 100 téléphones. Renvoie le nombre de téléphones
-- visés (0 sans pg_net). Appelée seulement par les déclencheurs ci-dessous.
CREATE OR REPLACE FUNCTION public.send_push(
  p_users uuid[],
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  tokens text[];
  i integer;
BEGIN
  SELECT array_agg(t.token ORDER BY t.token) INTO tokens
  FROM public.push_tokens t WHERE t.user_id = ANY (p_users);
  IF tokens IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RETURN 0;
  END IF;
  FOR i IN 0 .. (cardinality(tokens) - 1) / 100 LOOP
    EXECUTE 'SELECT net.http_post(url => $1, body => $2)'
    USING 'https://exp.host/--/api/v2/push/send',
      jsonb_build_object(
        'to', to_jsonb(tokens[i * 100 + 1 : i * 100 + 100]),
        'title', left(p_title, 100),
        'body', left(p_body, 240),
        'data', coalesce(p_data, '{}'::jsonb),
        'sound', 'default',
        'priority', 'high',
        'channelId', 'plans',
        'threadId', coalesce(p_data ->> 'planId', 'plans'));
  END LOOP;
  RETURN cardinality(tokens);
EXCEPTION WHEN others THEN
  RAISE WARNING 'Notification poussée non envoyée : %', SQLERRM;
  RETURN 0;
END;
$$;
--> statement-breakpoint

-- ─── Nouveau plan ──────────────────────────────────────────────────────────────────────────
-- Déclencheur différé (fin de transaction) : les invités et la répétition d'une série sont
-- écrits après le plan, dans la même fonction (propose_meetup, propose_recurring_meetup).
CREATE OR REPLACE FUNCTION public.notify_plan_proposed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  plan public.meetup_plans%ROWTYPE;
  targets uuid[];
  grp text;
BEGIN
  SELECT * INTO plan FROM public.meetup_plans m WHERE m.id = NEW.id;
  IF NOT FOUND OR plan.status <> 'proposed' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(i.user_id) INTO targets
  FROM public.plan_invitees i WHERE i.plan_id = plan.id AND i.user_id <> plan.created_by;
  IF targets IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT g.name INTO grp FROM public.groups g WHERE g.id = plan.group_id;
  PERFORM public.send_push(
    targets,
    'Nouveau plan : ' || plan.title,
    public.push_name(plan.created_by) || ' propose '
      || CASE WHEN plan.repeat_unit IS NULL THEN '' ELSE 'une série, dès ' END
      || public.push_when_fr(plan.starts_at)
      || coalesce(' (' || grp || ')', '') || '. Tu y vas ?',
    jsonb_build_object('url', '/plans', 'planId', plan.id, 'kind', 'proposed'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER meetup_plans_notify_proposed
  AFTER INSERT ON public.meetup_plans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.notify_plan_proposed();
--> statement-breakpoint

-- ─── Réponse à mon plan ────────────────────────────────────────────────────────────────────
-- Contre le harcèlement (accepter, refuser, accepter…) : un changement de réponse moins de
-- 10 minutes après la réponse précédente ne fait pas de notification.
CREATE OR REPLACE FUNCTION public.notify_plan_vote()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  plan public.meetup_plans%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.vote = NEW.vote OR OLD.updated_at > now() - interval '10 minutes') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO plan FROM public.meetup_plans m WHERE m.id = NEW.plan_id;
  IF NOT FOUND OR plan.created_by = NEW.user_id OR plan.status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  PERFORM public.send_push(
    ARRAY[plan.created_by],
    public.push_name(NEW.user_id)
      || CASE WHEN NEW.vote = 'yes' THEN ' a accepté ton plan'
        WHEN plan.repeat_unit IS NOT NULL AND TG_OP = 'UPDATE' THEN ' a quitté ta série'
        ELSE ' a refusé ton plan' END,
    '« ' || plan.title || ' » · '
      || CASE WHEN plan.repeat_unit IS NULL THEN public.push_when_fr(plan.starts_at)
        ELSE 'série dès ' || public.push_when_fr(plan.starts_at) END,
    jsonb_build_object('url', '/plans', 'planId', plan.id, 'kind', 'vote'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER plan_votes_notify
  AFTER INSERT OR UPDATE OF vote ON public.plan_votes
  FOR EACH ROW EXECUTE FUNCTION public.notify_plan_vote();
--> statement-breakpoint

-- ─── Plan annulé ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_plan_cancelled()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  who uuid := coalesce(auth.uid(), NEW.created_by);
  targets uuid[];
BEGIN
  SELECT array_agg(i.user_id) INTO targets
  FROM public.plan_invitees i
  WHERE i.plan_id = NEW.id AND i.user_id <> who
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_votes v
      WHERE v.plan_id = NEW.id AND v.user_id = i.user_id AND v.vote = 'no'
    );
  IF targets IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.send_push(
    targets,
    CASE WHEN NEW.repeat_unit IS NULL THEN 'Plan annulé : ' ELSE 'Série arrêtée : ' END
      || NEW.title,
    public.push_name(who)
      || CASE WHEN NEW.repeat_unit IS NULL
        THEN ' a annulé « ' || NEW.title || ' » (' || public.push_when_fr(NEW.starts_at) || ').'
        ELSE ' a arrêté la série « ' || NEW.title || ' ».' END,
    jsonb_build_object('url', '/plans', 'planId', NEW.id, 'kind', 'cancelled'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER meetup_plans_notify_cancelled
  AFTER UPDATE OF status ON public.meetup_plans
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled')
  EXECUTE FUNCTION public.notify_plan_cancelled();
--> statement-breakpoint

-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.register_push_token(text, text),
  public.push_when_fr(timestamptz), public.push_name(uuid),
  public.send_push(uuid[], text, text, jsonb), public.notify_plan_proposed(),
  public.notify_plan_vote(), public.notify_plan_cancelled()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;
