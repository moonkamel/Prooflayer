-- Retour arrière de 20261111120000_audit_log_append_only (PL-106).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111120000_audit_log_append_only/down.sql
DROP TRIGGER IF EXISTS audit_log_guard ON "AuditLog";
DROP FUNCTION IF EXISTS audit_log_guard();

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111120000_audit_log_append_only';
