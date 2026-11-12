-- Retour arrière de 20261112110000_public_lead (PL-208).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112110000_public_lead/down.sql
DROP TABLE IF EXISTS "PublicLead";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112110000_public_lead';
