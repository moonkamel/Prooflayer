-- Retour arrière de 20261115180000_final_review (revue finale 2/2).
DROP FUNCTION IF EXISTS integration_status_counts();
GRANT DELETE ON "OrganizationDeletion" TO prooflayer_app;
DROP TRIGGER IF EXISTS organization_deletion_guard ON "OrganizationDeletion";
DROP FUNCTION IF EXISTS organization_deletion_guard();
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

-- La valeur d'énumération EXPIRED ne se retire pas (PostgreSQL) : les exports expirés redeviennent FAILED.
UPDATE "OrgExport" SET status = 'FAILED' WHERE status = 'EXPIRED';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115180000_final_review';
