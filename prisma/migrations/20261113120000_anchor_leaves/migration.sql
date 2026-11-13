-- PL-503 : les feuilles d'une ancre (batchHash des lots, dans l'ordre d'anchorLeafIndex) sont conservées sur l'ancre.
-- Sans elles, la purge d'une organisation (RGPD) supprimerait ses lots et rendrait invérifiables les ancres partagées
-- avec les autres organisations. Un batchHash ne révèle rien du contenu : l'ancre reste publique par construction.
ALTER TABLE "Anchor" ADD COLUMN "batchHashes" BYTEA[] NOT NULL DEFAULT '{}';

-- Reprise des ancres existantes (l'ancre est en ajout seul : garde levée le temps de la reprise).
ALTER TABLE "Anchor" DISABLE TRIGGER anchor_guard;
UPDATE "Anchor" a SET "batchHashes" = sub.hashes
FROM (
  SELECT b."anchorId", array_agg(b."batchHash" ORDER BY b."anchorLeafIndex") AS hashes
  FROM "SealBatch" b WHERE b."anchorId" IS NOT NULL GROUP BY b."anchorId"
) sub
WHERE sub."anchorId" = a.id;
ALTER TABLE "Anchor" ENABLE TRIGGER anchor_guard;
