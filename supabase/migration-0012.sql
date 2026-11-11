-- ════════════════════════════════════════════════════════════════════════════════════════
-- Freecrew : migration 0012_segment18_availability_slots SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/0012_segment18_availability_slots.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Migration 0012_segment18_availability_slots ─────────────────────────────────────

-- Segment 18 (bonus) : disponibilités ponctuelles (« ce samedi, je suis libre de 13 h à
-- 18 h »). Début généré par drizzle-kit (table, contraintes), suite écrite à la main (droits,
-- RLS, limites, lecture par les membres des groupes).
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT auth.uid() NOT NULL,
	"day" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_slots_time_order" CHECK ("availability_slots"."end_time" - "availability_slots"."start_time" >= interval '15 minutes'),
	CONSTRAINT "availability_slots_day_range" CHECK ("availability_slots"."day" >= '2020-01-01' and "availability_slots"."day" < '2100-01-01'),
	CONSTRAINT "availability_slots_note_length" CHECK (length("availability_slots"."note") <= 60),
	CONSTRAINT "availability_slots_note_chars" CHECK ("availability_slots"."note" !~ '[\x01-\x1f\x7f-\x9f]')
);

ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "availability_slots_owner_day_idx" ON "availability_slots" USING btree ("owner_id","day");


-- ─── Droits et RLS : seulement la personne elle-même ──────────────────────────────────────
-- Supabase donne par défaut tous les droits sur une nouvelle table à anon et authenticated :
-- on les retire, puis on ne rend que le nécessaire (droits par colonne : id, owner_id et
-- created_at ne se modifient pas).
REVOKE ALL ON public.availability_slots FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.availability_slots TO authenticated;

GRANT INSERT (owner_id, day, start_time, end_time, note) ON public.availability_slots TO authenticated;

GRANT UPDATE (day, start_time, end_time, note) ON public.availability_slots TO authenticated;

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_slots_select ON public.availability_slots FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_insert ON public.availability_slots FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_update ON public.availability_slots FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY availability_slots_delete ON public.availability_slots FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- ─── Limites ───────────────────────────────────────────────────────────────────────────────
-- Comme les blocs et les échéances : la clé anon est publique, on pourrait sinon créer des
-- milliers de lignes par l'API REST (elles sont lues à chaque recherche des membres des
-- groupes). Seules les disponibilités à venir comptent (les passées ne sont plus lues par
-- group_availability_slots et ne bloquent pas). Le jour est revérifié seulement quand il change.
CREATE OR REPLACE FUNCTION public.enforce_availability_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    SELECT count(*) FROM public.availability_slots a
    WHERE a.owner_id = NEW.owner_id AND a.day >= current_date - 1
  ) >= 100 THEN
    RAISE EXCEPTION 'Trop de disponibilités (100 au maximum). Supprime les anciennes.'
      USING ERRCODE = '54000';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.day IS DISTINCT FROM OLD.day)
    AND (NEW.day < current_date - 1 OR NEW.day > current_date + 366) THEN
    RAISE EXCEPTION 'Le jour doit être dans l''année qui vient.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS availability_slots_limits ON public.availability_slots;

CREATE TRIGGER availability_slots_limits
  BEFORE INSERT OR UPDATE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_availability_limits();


-- ─── Lecture par les membres d'un groupe ──────────────────────────────────────────────────
-- Comme group_busy_blocks : seulement pour un membre du groupe, seulement les lignes des
-- membres, à partir d'hier. Jamais la note (privée).
CREATE OR REPLACE FUNCTION public.group_availability_slots(gid uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  day date,
  start_time time,
  end_time time
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.owner_id, a.day, a.start_time, a.end_time
  FROM public.availability_slots a
  JOIN public.group_members m ON m.user_id = a.owner_id AND m.group_id = gid
  WHERE public.is_group_member(gid) AND a.day >= current_date - 1
  ORDER BY a.owner_id, a.day, a.start_time;
$$;


-- ─── Droits d'exécution ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.enforce_availability_limits()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.group_availability_slots(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.group_availability_slots(uuid) TO authenticated;

COMMIT;
