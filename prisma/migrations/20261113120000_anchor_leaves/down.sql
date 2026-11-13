-- Retour arrière de 20261113120000_anchor_leaves (PL-503).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261113120000_anchor_leaves/down.sql
ALTER TABLE "Anchor" DISABLE TRIGGER anchor_guard;
ALTER TABLE "Anchor" DROP COLUMN IF EXISTS "batchHashes";
ALTER TABLE "Anchor" ENABLE TRIGGER anchor_guard;

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113120000_anchor_leaves';
