-- PL-607 : réversibilité. Export complet d'une organisation, suppression programmée, purge par une fonction unique.

CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'FAILED');

CREATE TABLE "OrgExport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "objectKey" TEXT,
    "sizeBytes" INTEGER,
    "counts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "OrgExport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrgExport_orgId_createdAt_idx" ON "OrgExport"("orgId", "createdAt" DESC);
ALTER TABLE "OrgExport" ADD CONSTRAINT "OrgExport_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation entre organisations (convention de PL-105).
ALTER TABLE "OrgExport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgExport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgExport"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Table système (sans RLS, comme Job) : la trace de suppression survit à l'organisation.
CREATE TABLE "OrganizationDeletion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notifyEmails" JSONB,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "OrganizationDeletion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationDeletion_reason_check" CHECK ("reason" IN ('owner_request', 'contract_end'))
);
CREATE INDEX "OrganizationDeletion_scheduledFor_idx" ON "OrganizationDeletion"("scheduledFor");
CREATE INDEX "OrganizationDeletion_orgId_idx" ON "OrganizationDeletion"("orgId");
-- Une seule suppression en attente par organisation.
CREATE UNIQUE INDEX "OrganizationDeletion_pending_key" ON "OrganizationDeletion"("orgId")
  WHERE "cancelledAt" IS NULL AND "completedAt" IS NULL;

-- Purge complète d'une organisation (§4.7 : « purge à 90 jours, sauvegardes comprises par destruction de clé »).
-- Exécutée sous son propriétaire : elle seule pose app.purge_org, que les gardes des tables en ajout seul exigent
-- (evidence_guard, audit_log_guard, classification_guard, seal_batch_guard, exemption_dossier_guard). La clé de données
-- (OrgEncryptionKey) disparaît dans la même transaction : charges et pièces jointes des sauvegardes deviennent illisibles.
-- Les ancres (partagées entre organisations) restent : elles portent leurs propres feuilles (PL-503).
CREATE OR REPLACE FUNCTION purge_organization(target TEXT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  removed INTEGER;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'purge_organization: organisation absente';
  END IF;
  PERFORM set_config('app.purge_org', target, true);
  PERFORM set_config('app.org_id', target, true);
  DELETE FROM "EvidenceLink" WHERE "orgId" = target;
  DELETE FROM "ControlEvaluation" WHERE "orgId" = target;
  DELETE FROM "ControlComment" WHERE "orgId" = target;
  DELETE FROM "EvidenceItem" WHERE "orgId" = target;
  DELETE FROM "SealBatch" WHERE "orgId" = target;
  DELETE FROM "AuditPack" WHERE "orgId" = target;
  DELETE FROM "ExemptionDossier" WHERE "orgId" = target;
  DELETE FROM "Classification" WHERE "orgId" = target;
  DELETE FROM "AuditLog" WHERE "orgId" = target;
  DELETE FROM "Notification" WHERE "orgId" = target;
  DELETE FROM "Job" WHERE "orgId" = target;
  DELETE FROM "OrgEncryptionKey" WHERE "orgId" = target;
  DELETE FROM "Organization" WHERE id = target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION purge_organization(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_organization(TEXT) TO prooflayer_app;
