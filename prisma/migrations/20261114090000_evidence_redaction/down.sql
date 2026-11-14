-- Retour arrière de 20261114090000_evidence_redaction (PL-507).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261114090000_evidence_redaction/down.sql
-- evidence_guard tel que l'a posé 20261113100000_seal_batch_guard (PL-501).
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

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114090000_evidence_redaction';
