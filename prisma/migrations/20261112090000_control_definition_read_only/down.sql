-- Retour arrière de 20261112090000_control_definition_read_only (PL-206).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112090000_control_definition_read_only/down.sql
GRANT INSERT, UPDATE, DELETE ON "ControlDefinition" TO prooflayer_app;

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112090000_control_definition_read_only';
