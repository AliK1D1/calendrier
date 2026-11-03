-- Segment 13 : planificateur d'étude (échéances, séances acceptées dans l'horaire) et
-- préférences d'étude du segment 14. Début généré par drizzle-kit (tables, colonnes,
-- contraintes ; NOT VALID ajouté là où d'anciennes lignes 'study' écrites par l'API REST
-- pourraient ne pas respecter la règle), suite écrite à la main (droits, RLS, triggers,
-- confidentialité des séances dans l'horaire du groupe).
--
-- Les séances PROPOSÉES ne sont jamais écrites : seules les séances acceptées deviennent des
-- blocs busy_blocks (source 'study', deadline_id, movable).
CREATE TYPE "public"."deadline_kind" AS ENUM('exam', 'assignment');--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" "deadline_kind" DEFAULT 'exam' NOT NULL,
	"course" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"estimated_hours" double precision,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_course_not_blank" CHECK (length(trim("deadlines"."course")) > 0),
	CONSTRAINT "deadlines_course_length" CHECK (length("deadlines"."course") <= 80),
	CONSTRAINT "deadlines_course_chars" CHECK ("deadlines"."course" !~ '[\x01-\x1f\x7f-\x9f]'),
	CONSTRAINT "deadlines_estimated_hours_range" CHECK ("deadlines"."estimated_hours" is null or ("deadlines"."estimated_hours" >= 0.5 and "deadlines"."estimated_hours" <= 60 and "deadlines"."estimated_hours" * 2 = floor("deadlines"."estimated_hours" * 2))),
	CONSTRAINT "deadlines_difficulty_range" CHECK ("deadlines"."difficulty" between 1 and 3),
	CONSTRAINT "deadlines_due_at_range" CHECK ("deadlines"."due_at" >= '2020-01-01' and "deadlines"."due_at" < '2100-01-01')
);
--> statement-breakpoint
CREATE TABLE "study_preferences" (
	"owner_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"min_session_minutes" smallint DEFAULT 45 NOT NULL,
	"max_session_minutes" smallint DEFAULT 120 NOT NULL,
	"max_minutes_per_day" smallint DEFAULT 180 NOT NULL,
	"break_minutes" smallint DEFAULT 15 NOT NULL,
	"study_start" time DEFAULT '08:00' NOT NULL,
	"study_end" time DEFAULT '22:00' NOT NULL,
	"eve_cutoff" time DEFAULT '21:00',
	"keep_free_percent" smallint DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_preferences_min_session" CHECK ("study_preferences"."min_session_minutes" between 30 and 120 and "study_preferences"."min_session_minutes" % 15 = 0),
	CONSTRAINT "study_preferences_max_session" CHECK ("study_preferences"."max_session_minutes" between "study_preferences"."min_session_minutes" and 240 and "study_preferences"."max_session_minutes" % 15 = 0),
	CONSTRAINT "study_preferences_max_per_day" CHECK ("study_preferences"."max_minutes_per_day" between "study_preferences"."min_session_minutes" and 600 and "study_preferences"."max_minutes_per_day" % 15 = 0),
	CONSTRAINT "study_preferences_break" CHECK ("study_preferences"."break_minutes" between 0 and 60),
	CONSTRAINT "study_preferences_hours" CHECK ("study_preferences"."study_end" - "study_preferences"."study_start" >= make_interval(mins => "study_preferences"."min_session_minutes")),
	CONSTRAINT "study_preferences_keep_free" CHECK ("study_preferences"."keep_free_percent" between 0 and 90)
);
--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD COLUMN "deadline_id" uuid;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD COLUMN "movable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_preferences" ADD CONSTRAINT "study_preferences_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_owner_idx" ON "deadlines" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busy_blocks_deadline_idx" ON "busy_blocks" USING btree ("deadline_id");--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_study_link" CHECK (("busy_blocks"."source"::text = 'study') = ("busy_blocks"."deadline_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_study_one_off" CHECK ("busy_blocks"."source"::text <> 'study' or "busy_blocks"."weekday" is null) NOT VALID;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_movable_study" CHECK (not "busy_blocks"."movable" or "busy_blocks"."source"::text = 'study');
--> statement-breakpoint

-- ─── Échéances et préférences : visibles et modifiables seulement par leur propriétaire ────
-- Supabase donne par défaut tous les droits sur une nouvelle table à anon et authenticated :
-- on les retire, puis on ne rend que le nécessaire (droits par colonne : owner_id et id ne se
-- modifient pas).
REVOKE ALL ON public.deadlines, public.study_preferences FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, DELETE ON public.deadlines, public.study_preferences TO authenticated;
--> statement-breakpoint
GRANT INSERT (owner_id, kind, course, due_at, estimated_hours, difficulty)
  ON public.deadlines TO authenticated;
--> statement-breakpoint
GRANT UPDATE (kind, course, due_at, estimated_hours, difficulty) ON public.deadlines TO authenticated;
--> statement-breakpoint
GRANT INSERT (owner_id, min_session_minutes, max_session_minutes, max_minutes_per_day,
  break_minutes, study_start, study_end, eve_cutoff, keep_free_percent)
  ON public.study_preferences TO authenticated;
--> statement-breakpoint
GRANT UPDATE (min_session_minutes, max_session_minutes, max_minutes_per_day, break_minutes,
  study_start, study_end, eve_cutoff, keep_free_percent)
  ON public.study_preferences TO authenticated;
--> statement-breakpoint
ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.study_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY deadlines_select ON public.deadlines FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY deadlines_insert ON public.deadlines FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY deadlines_update ON public.deadlines FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY deadlines_delete ON public.deadlines FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY study_preferences_select ON public.study_preferences FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY study_preferences_insert ON public.study_preferences FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY study_preferences_update ON public.study_preferences FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY study_preferences_delete ON public.study_preferences FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP TRIGGER IF EXISTS study_preferences_touch ON public.study_preferences;
--> statement-breakpoint
CREATE TRIGGER study_preferences_touch
  BEFORE UPDATE ON public.study_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint

-- ─── Limites des échéances ─────────────────────────────────────────────────────────────────
-- Comme les lieux et les blocs (0008) : la clé anon est publique, on pourrait sinon créer des
-- milliers d'échéances par l'API REST (chacune est lue à chaque planification). La date est
-- revérifiée seulement quand elle change : on peut corriger le nom d'un examen passé.
CREATE OR REPLACE FUNCTION public.enforce_deadline_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND (SELECT count(*) FROM public.deadlines d WHERE d.owner_id = NEW.owner_id) >= 100 THEN
    RAISE EXCEPTION 'Trop d''examens et de travaux (100 au maximum). Supprime les anciens.'
      USING ERRCODE = '54000';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.due_at IS DISTINCT FROM OLD.due_at)
    AND (NEW.due_at < now() - interval '1 day' OR NEW.due_at > now() + interval '366 days') THEN
    RAISE EXCEPTION 'La date doit être dans l''année qui vient.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS deadlines_limits ON public.deadlines;
--> statement-breakpoint
CREATE TRIGGER deadlines_limits
  BEFORE INSERT OR UPDATE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_deadline_limits();
--> statement-breakpoint

-- ─── Séances acceptées dans busy_blocks ────────────────────────────────────────────────────
-- deadline_id ne peut pointer que vers une échéance de la MÊME personne. La politique
-- d'insertion ne suffit pas : la clé étrangère est vérifiée sans RLS, on pourrait donc viser
-- l'échéance d'un autre (et, par la cascade, voir son bloc disparaître quand il la supprime).
CREATE OR REPLACE FUNCTION public.check_block_deadline_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.deadline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.deadlines d
    WHERE d.id = NEW.deadline_id AND d.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Échéance introuvable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS busy_blocks_deadline_owner ON public.busy_blocks;
--> statement-breakpoint
CREATE TRIGGER busy_blocks_deadline_owner
  BEFORE INSERT OR UPDATE OF deadline_id, owner_id ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.check_block_deadline_owner();
--> statement-breakpoint
-- On écrit deadline_id et movable en créant une séance ; ensuite seul movable se modifie.
GRANT INSERT (deadline_id, movable) ON public.busy_blocks TO authenticated;
--> statement-breakpoint
GRANT UPDATE (movable) ON public.busy_blocks TO authenticated;
--> statement-breakpoint

-- ─── Confidentialité : une séance d'étude est toujours « Occupé » pour les autres ─────────
-- Le titre d'une séance contient le nom du cours, et les échéances sont privées : même si la
-- personne montre ses titres (hide_block_titles faux), les membres de ses groupes voient
-- « Occupé ». Le reste est inchangé (migration 0010).
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
        OR NOT (p.hide_block_titles OR b.source::text = 'study'
          OR coalesce(mp.group_id <> gid, false))
      THEN b.title ELSE 'Occupé' END,
    b.owner_id <> (SELECT auth.uid())
      AND (p.hide_block_titles OR b.source::text = 'study' OR coalesce(mp.group_id <> gid, false)),
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
--> statement-breakpoint

-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.enforce_deadline_limits(),
  public.check_block_deadline_owner() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.group_busy_blocks(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.group_busy_blocks(uuid) TO authenticated;
