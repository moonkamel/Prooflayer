-- PL-502 : ancrage global (§4.6.2 étape 3). L'ancre couvre les lots de toutes les organisations, protégés par RLS ;
-- deux fonctions du rôle de migration, à portée étroite, font le pont (modèle de resolve_integration, PL-302) :
--   pending_batches_for_anchor : identifiant, empreinte et date des lots sans ancre (aucune autre donnée) ;
--   attach_batches_to_anchor : rattache ces lots à l'ancre créée, une seule fois (seal_batch_guard).
-- Anchor est en ajout seul : ni modification ni suppression, y compris pour le propriétaire.
CREATE OR REPLACE FUNCTION pending_batches_for_anchor(p_limit INTEGER)
RETURNS TABLE ("id" TEXT, "batchHash" BYTEA, "sealedAt" TIMESTAMP(3))
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT b.id, b."batchHash", b."sealedAt"
  FROM "SealBatch" b
  WHERE b."anchorId" IS NULL
  ORDER BY b."sealedAt", b.id
  LIMIT p_limit
$$;

CREATE OR REPLACE FUNCTION attach_batches_to_anchor(p_anchor_id TEXT, p_ids TEXT[], p_indexes INTEGER[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  updated INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Anchor" a WHERE a.id = p_anchor_id) THEN
    RAISE EXCEPTION 'ancre inconnue';
  END IF;
  UPDATE "SealBatch" b SET "anchorId" = p_anchor_id, "anchorLeafIndex" = u.idx
  FROM unnest(p_ids, p_indexes) AS u(id, idx)
  WHERE b.id = u.id AND b."anchorId" IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION pending_batches_for_anchor(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION attach_batches_to_anchor(TEXT, TEXT[], INTEGER[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_batches_for_anchor(INTEGER) TO prooflayer_app;
GRANT EXECUTE ON FUNCTION attach_batches_to_anchor(TEXT, TEXT[], INTEGER[]) TO prooflayer_app;

CREATE OR REPLACE FUNCTION anchor_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Anchor est en ajout seul';
END $$;

CREATE TRIGGER anchor_guard
  BEFORE UPDATE OR DELETE ON "Anchor"
  FOR EACH ROW EXECUTE FUNCTION anchor_guard();

REVOKE UPDATE, DELETE ON "Anchor" FROM prooflayer_app;
