-- Retour arrière de 20261113110000_anchor (PL-502).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261113110000_anchor/down.sql
GRANT UPDATE, DELETE ON "Anchor" TO prooflayer_app;
DROP TRIGGER IF EXISTS anchor_guard ON "Anchor";
DROP FUNCTION IF EXISTS anchor_guard();
DROP FUNCTION IF EXISTS attach_batches_to_anchor(TEXT, TEXT[], INTEGER[]);
DROP FUNCTION IF EXISTS pending_batches_for_anchor(INTEGER);

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113110000_anchor';
