-- Retour arrière de 20261112130000_resolve_integration (PL-302).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112130000_resolve_integration/down.sql
DROP FUNCTION IF EXISTS resolve_integration("IntegrationProvider", TEXT);

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112130000_resolve_integration';
