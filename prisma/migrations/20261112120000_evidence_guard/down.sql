-- Retour arrière de 20261112120000_evidence_guard (PL-304).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112120000_evidence_guard/down.sql
DROP TRIGGER IF EXISTS evidence_guard ON "EvidenceItem";
DROP FUNCTION IF EXISTS evidence_guard();

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112120000_evidence_guard';
