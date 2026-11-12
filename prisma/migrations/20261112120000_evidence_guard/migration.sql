-- PL-304 : table des preuves en ajout seul (§4.3.3, point 2 ; code repris du cahier des charges, search_path figé
-- comme pour audit_log_guard). Pas de suppression, hors purge d'une organisation ; mises à jour limitées au
-- scellement (sealBatchId, leafIndex, une seule fois) et à l'effacement (payload, actor, sel à NULL).
CREATE OR REPLACE FUNCTION evidence_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Seule la purge complète d'une organisation, lancée par le rôle propriétaire, peut supprimer.
    IF current_setting('app.purge_org', true) = OLD."orgId" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'EvidenceItem est en ajout seul';
  END IF;

  IF NEW."leafHash" IS DISTINCT FROM OLD."leafHash"
     OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
     OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
     OR NEW."capturedAt" IS DISTINCT FROM OLD."capturedAt"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."sourceRef" IS DISTINCT FROM OLD."sourceRef"
     OR NEW."orgId" IS DISTINCT FROM OLD."orgId" THEN
    RAISE EXCEPTION 'champ scellé non modifiable';
  END IF;

  IF OLD."sealBatchId" IS NOT NULL
     AND NEW."sealBatchId" IS DISTINCT FROM OLD."sealBatchId" THEN
    RAISE EXCEPTION 'preuve déjà scellée';
  END IF;

  IF NEW."payload" IS DISTINCT FROM OLD."payload" AND NEW."payload" IS NOT NULL THEN
    RAISE EXCEPTION 'payload : seule la mise à NULL (effacement) est autorisée';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER evidence_guard
  BEFORE UPDATE OR DELETE ON "EvidenceItem"
  FOR EACH ROW EXECUTE FUNCTION evidence_guard();
