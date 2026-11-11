-- Retour arrière de 20261111110000_rls (PL-105).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111110000_rls/down.sql
-- Supprime l'isolation par organisation : à ne faire que pour revenir à l'état de PL-104.

DROP POLICY IF EXISTS tenant_isolation ON "OrgEncryptionKey";
ALTER TABLE "OrgEncryptionKey" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "OrgEncryptionKey" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ApiKey";
ALTER TABLE "ApiKey" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Subscription";
ALTER TABLE "Subscription" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Notification";
ALTER TABLE "Notification" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
ALTER TABLE "AuditLog" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "AuditPack";
ALTER TABLE "AuditPack" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditPack" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SealBatch";
ALTER TABLE "SealBatch" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "SealBatch" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "EvidenceLink";
ALTER TABLE "EvidenceLink" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceLink" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "EvidenceItem";
ALTER TABLE "EvidenceItem" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceItem" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SystemResourceLink";
ALTER TABLE "SystemResourceLink" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "SystemResourceLink" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "IntegrationResource";
ALTER TABLE "IntegrationResource" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationResource" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Integration";
ALTER TABLE "Integration" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Integration" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ControlEvaluation";
ALTER TABLE "ControlEvaluation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ControlEvaluation" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ControlInstance";
ALTER TABLE "ControlInstance" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ControlInstance" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "DesignChange";
ALTER TABLE "DesignChange" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "DesignChange" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Classification";
ALTER TABLE "Classification" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Classification" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "AiSystem";
ALTER TABLE "AiSystem" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiSystem" DISABLE ROW LEVEL SECURITY;

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111110000_rls';
