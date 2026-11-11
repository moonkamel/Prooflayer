-- PL-105 : isolation entre organisations par Row Level Security (§4.3.3, §4.7).
-- Chaque table métier portant "orgId" n'expose que les lignes de l'organisation positionnée par forOrg()
-- (SELECT set_config('app.org_id', <orgId>, TRUE) dans la même transaction). Sans ce réglage : aucune ligne.
-- FORCE : la politique s'applique aussi au propriétaire des tables. Seuls un superutilisateur ou un rôle BYPASSRLS
-- y échappent ; le rôle applicatif prooflayer_app n'est ni l'un ni l'autre (PL-102).
--
-- Tables système, sans RLS (prompt-type de PL-105) : WebhookDelivery, Job, ControlDefinition, Anchor, SigningKey,
-- RegulatoryUpdate. Job porte un "orgId" facultatif mais reste une table système, drainée par le cron (§4.2).
-- Tables d'identité gérées par Better Auth, sans "orgId" : hors de ce périmètre.

-- AiSystem
ALTER TABLE "AiSystem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSystem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiSystem"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Classification
ALTER TABLE "Classification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Classification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Classification"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- DesignChange
ALTER TABLE "DesignChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DesignChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DesignChange"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- ControlInstance
ALTER TABLE "ControlInstance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlInstance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ControlInstance"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- ControlEvaluation
ALTER TABLE "ControlEvaluation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlEvaluation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ControlEvaluation"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Integration
ALTER TABLE "Integration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Integration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Integration"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- IntegrationResource
ALTER TABLE "IntegrationResource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationResource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntegrationResource"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- SystemResourceLink
ALTER TABLE "SystemResourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemResourceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SystemResourceLink"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- EvidenceItem
ALTER TABLE "EvidenceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EvidenceItem"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- EvidenceLink
ALTER TABLE "EvidenceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EvidenceLink"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- SealBatch
ALTER TABLE "SealBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SealBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SealBatch"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- AuditPack
ALTER TABLE "AuditPack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditPack" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditPack"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- AuditLog
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Subscription
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- ApiKey
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiKey"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- OrgEncryptionKey
ALTER TABLE "OrgEncryptionKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgEncryptionKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgEncryptionKey"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));
