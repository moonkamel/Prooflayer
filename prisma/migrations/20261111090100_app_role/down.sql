-- Retour arrière de 20261111090100_app_role (PL-102).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111090100_app_role/down.sql
--
-- Volontairement non rétabli : l'accès des rôles Supabase anon et authenticated au schéma public.
-- Le rétablir exposerait les tables par l'API de données sans RLS. Si ce retour est un jour nécessaire,
-- il se fait à la main et en connaissance de cause.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prooflayer_app') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prooflayer_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE USAGE, SELECT ON SEQUENCES FROM prooflayer_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM prooflayer_app;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM prooflayer_app;
    REVOKE ALL ON SCHEMA public FROM prooflayer_app;
    DROP ROLE prooflayer_app;
  END IF;
END $$;

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090100_app_role';
