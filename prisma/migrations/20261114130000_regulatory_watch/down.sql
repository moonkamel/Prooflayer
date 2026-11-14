-- Retour arrière de 20261114130000_regulatory_watch (PL-603).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261114130000_regulatory_watch/down.sql
ALTER TABLE "RegulatoryUpdate" DROP COLUMN IF EXISTS "notifiedAt";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114130000_regulatory_watch';
