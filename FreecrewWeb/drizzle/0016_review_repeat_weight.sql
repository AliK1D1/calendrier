-- Migration de la revue sécurité (story 2, répétition personnalisée).
--
-- 1. Un bloc « tous les jours » compte pour 7 dans la limite de 1000 blocs (migration 0008).
--    La limite comptait les lignes. Un bloc hebdomadaire revient une fois par semaine, mais un
--    bloc « tous les jours » revient 7 fois : 1000 blocs « tous les jours » donnaient
--    7000 blocs par semaine à déplier pour chaque membre de ses groupes (recherche de moments,
--    « Je suis libre maintenant », 2,6 s → 6,6 s). Maintenant, un bloc « tous les X jours »
--    compte pour ceil(7 / X) : au plus 1000 blocs par semaine, comme avant. Sans bloc
--    « tous les jours », rien ne change (tous les poids valent 1).
CREATE OR REPLACE FUNCTION public.busy_block_weight(unit text, every integer)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN unit = 'day' THEN ceil(7.0 / greatest(coalesce(every, 1), 1))::integer ELSE 1 END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_repeat_weight()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  w integer := public.busy_block_weight(NEW.repeat_unit, NEW.repeat_every);
BEGIN
  IF TG_OP = 'UPDATE' AND w <= public.busy_block_weight(OLD.repeat_unit, OLD.repeat_every) THEN
    RETURN NEW;
  END IF;
  IF w + (
    SELECT coalesce(sum(public.busy_block_weight(b.repeat_unit, b.repeat_every)), 0)
    FROM public.busy_blocks b
    WHERE b.owner_id = NEW.owner_id AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
  ) > 1000 THEN
    RAISE EXCEPTION 'Trop de blocs dans l''horaire (1000 au maximum ; un bloc « tous les jours » compte pour 7)'
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS busy_blocks_repeat_weight ON public.busy_blocks;
--> statement-breakpoint
CREATE TRIGGER busy_blocks_repeat_weight
  BEFORE INSERT OR UPDATE OF repeat_unit, repeat_every ON public.busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_repeat_weight();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.enforce_repeat_weight(), public.busy_block_weight(text, integer)
  FROM PUBLIC, anon, authenticated;
