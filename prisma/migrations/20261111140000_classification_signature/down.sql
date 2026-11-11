-- Retour arrière de 20261111140000_classification_signature (PL-204).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111140000_classification_signature/down.sql
DROP TRIGGER IF EXISTS classification_guard ON "Classification";
DROP FUNCTION IF EXISTS classification_guard();
ALTER TABLE "Classification" DROP COLUMN "signedByName";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111140000_classification_signature';
