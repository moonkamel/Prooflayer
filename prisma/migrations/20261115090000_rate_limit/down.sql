-- Retour arrière de 20261115090000_rate_limit (PL-605).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261115090000_rate_limit/down.sql
DROP TABLE IF EXISTS "RateLimit";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115090000_rate_limit';
