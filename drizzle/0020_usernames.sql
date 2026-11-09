ALTER TABLE "profiles" ADD COLUMN "username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles" USING btree ("username");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_username_format" CHECK ("profiles"."username" ~ '^[a-z0-9][a-z0-9_.]{2,19}$');--> statement-breakpoint
-- Création de compte avec nom d'utilisateur et mot de passe (plus de lien par courriel).
-- Le formulaire /inscription passe le nom dans les métadonnées du compte
-- (`raw_user_meta_data.username`) ; le déclencheur le copie dans le profil. S'il est déjà pris
-- (deux inscriptions en même temps), l'index unique fait échouer l'inscription : le compte
-- n'est pas créé. Un nom absent ou mal formé (compte Google) laisse `username` vide.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  wanted text := lower(trim(coalesce(NEW.raw_user_meta_data ->> 'username', '')));
  uname text := CASE WHEN wanted ~ '^[a-z0-9][a-z0-9_.]{2,19}$' THEN wanted END;
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    left(
      coalesce(
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        uname,
        nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
        ''
      ),
      60
    ),
    uname
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
