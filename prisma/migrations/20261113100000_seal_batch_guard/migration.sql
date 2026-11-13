-- PL-501 : scellement par lots (§4.6.2, étape 2).
-- 1. evidence_guard : la position d'une feuille (leafIndex) est posée avec son lot, puis ne change plus.
-- 2. seal_batch_guard : un lot est en ajout seul. Seule son ancre (anchorId, anchorLeafIndex) se pose, une fois
--    (PL-502). Suppression seulement à la purge d'une organisation (app.purge_org).
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
     AND (NEW."sealBatchId" IS DISTINCT FROM OLD."sealBatchId"
          OR NEW."leafIndex" IS DISTINCT FROM OLD."leafIndex") THEN
    RAISE EXCEPTION 'preuve déjà scellée';
  END IF;

  -- PL-501 : une preuve se scelle avec sa position dans le lot, et seulement avec elle.
  IF (NEW."sealBatchId" IS NULL) <> (NEW."leafIndex" IS NULL) THEN
    RAISE EXCEPTION 'lot et position de la feuille vont ensemble';
  END IF;

  IF NEW."payload" IS DISTINCT FROM OLD."payload" AND NEW."payload" IS NOT NULL THEN
    RAISE EXCEPTION 'payload : seule la mise à NULL (effacement) est autorisée';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION seal_batch_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.purge_org', true) = OLD."orgId" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SealBatch est en ajout seul';
  END IF;
  IF NEW."orgId" IS DISTINCT FROM OLD."orgId"
     OR NEW."seq" IS DISTINCT FROM OLD."seq"
     OR NEW."leafCount" IS DISTINCT FROM OLD."leafCount"
     OR NEW."merkleRoot" IS DISTINCT FROM OLD."merkleRoot"
     OR NEW."prevBatchHash" IS DISTINCT FROM OLD."prevBatchHash"
     OR NEW."batchHash" IS DISTINCT FROM OLD."batchHash"
     OR NEW."sealedAt" IS DISTINCT FROM OLD."sealedAt" THEN
    RAISE EXCEPTION 'lot scellé non modifiable';
  END IF;
  IF OLD."anchorId" IS NOT NULL
     AND (NEW."anchorId" IS DISTINCT FROM OLD."anchorId"
          OR NEW."anchorLeafIndex" IS DISTINCT FROM OLD."anchorLeafIndex") THEN
    RAISE EXCEPTION 'lot déjà ancré';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER seal_batch_guard
  BEFORE UPDATE OR DELETE ON "SealBatch"
  FOR EACH ROW EXECUTE FUNCTION seal_batch_guard();
