-- PL-507 : effacement compatible avec le scellement (§4.6.5, §4.3.3). evidence_guard limite l'effacement à la mise à
-- NULL de la charge, de l'acteur, du sel, de la charge brute et de la pièce jointe, une seule fois, daté.
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

  -- PL-507 : effacement (§4.6.5). Acteur, sel, charge brute et pièce jointe ne peuvent qu'être mis à NULL ; la date
  -- d'effacement se pose une fois et ne s'efface pas ; une preuve effacée reste sans charge, acteur, sel ni fichiers.
  IF (NEW."actor" IS DISTINCT FROM OLD."actor" AND NEW."actor" IS NOT NULL)
     OR (NEW."salt" IS DISTINCT FROM OLD."salt" AND NEW."salt" IS NOT NULL)
     OR (NEW."rawObjectKey" IS DISTINCT FROM OLD."rawObjectKey" AND NEW."rawObjectKey" IS NOT NULL)
     OR (NEW."attachmentKey" IS DISTINCT FROM OLD."attachmentKey" AND NEW."attachmentKey" IS NOT NULL) THEN
    RAISE EXCEPTION 'effacement : acteur, sel et fichiers ne peuvent qu''être mis à NULL';
  END IF;
  IF OLD."redactedAt" IS NOT NULL AND NEW."redactedAt" IS DISTINCT FROM OLD."redactedAt" THEN
    RAISE EXCEPTION 'preuve déjà effacée';
  END IF;
  IF NEW."redactedAt" IS NOT NULL
     AND (NEW."payload" IS NOT NULL OR NEW."actor" IS NOT NULL OR NEW."salt" IS NOT NULL
          OR NEW."rawObjectKey" IS NOT NULL OR NEW."attachmentKey" IS NOT NULL) THEN
    RAISE EXCEPTION 'preuve effacée : charge, acteur, sel et fichiers à NULL';
  END IF;
  IF NEW."redactedAt" IS NULL AND OLD."salt" IS NOT NULL AND NEW."salt" IS NULL THEN
    RAISE EXCEPTION 'le sel ne disparaît qu''avec l''effacement';
  END IF;

  RETURN NEW;
END $$;
