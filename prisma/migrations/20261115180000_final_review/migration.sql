-- Revue finale (2/2).

-- 1. Un export complet expire : son archive est supprimée après 7 jours.
ALTER TYPE "ExportStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 2. purge_organization : gardée par une suppression programmée arrivée à échéance.
CREATE OR REPLACE FUNCTION purge_organization(target TEXT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  removed INTEGER;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'purge_organization: organisation absente';
  END IF;
  -- Revue finale : le rôle applicatif ne purge qu'une organisation dont la suppression programmée est arrivée à
  -- échéance. Un rôle d'administration (migrations, tests, intervention manuelle) reste libre.
  IF session_user = 'prooflayer_app' AND NOT EXISTS (
    SELECT 1 FROM "OrganizationDeletion" d
    WHERE d."orgId" = target AND d."cancelledAt" IS NULL AND d."completedAt" IS NULL
      AND d."scheduledFor" <= now()
  ) THEN
    RAISE EXCEPTION 'purge_organization: aucune suppression arrivée à échéance pour cette organisation';
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

-- 3. Une suppression programmée ne peut pas être antidatée par le rôle applicatif : à l'insertion, l'échéance est à
--    6 jours au moins ; ensuite, ni l'organisation ni l'échéance ne changent. Avec le point 2, effacer les preuves
--    d'une organisation depuis le rôle applicatif demande donc au moins 6 jours, pendant lesquels les owners sont
--    prévenus et la suppression reste annulable.
CREATE OR REPLACE FUNCTION organization_deletion_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF session_user <> 'prooflayer_app' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."scheduledFor" < now() + interval '6 days' OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'OrganizationDeletion: échéance trop proche';
    END IF;
  ELSIF NEW."orgId" <> OLD."orgId" OR NEW."scheduledFor" <> OLD."scheduledFor"
     OR NEW."requestedAt" <> OLD."requestedAt" THEN
    RAISE EXCEPTION 'OrganizationDeletion: organisation et échéance immuables';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_deletion_guard BEFORE INSERT OR UPDATE ON "OrganizationDeletion"
  FOR EACH ROW EXECUTE FUNCTION organization_deletion_guard();
REVOKE DELETE ON "OrganizationDeletion" FROM prooflayer_app;

-- 4. Surveillance : connecteurs en erreur, toutes organisations confondues, sans parcourir chacune (décomptes seuls).
CREATE OR REPLACE FUNCTION integration_status_counts()
RETURNS TABLE (provider TEXT, status TEXT, count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.provider::text, i.status::text, count(*)::int
  FROM "Integration" i
  WHERE i.status IN ('ERROR', 'REVOKED')
  GROUP BY 1, 2
$$;
REVOKE ALL ON FUNCTION integration_status_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_status_counts() TO prooflayer_app;
