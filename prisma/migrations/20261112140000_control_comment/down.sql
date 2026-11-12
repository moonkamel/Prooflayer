-- Retour arrière de 20261112140000_control_comment (PL-407).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112140000_control_comment/down.sql
DROP TABLE IF EXISTS "ControlComment";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112140000_control_comment';
