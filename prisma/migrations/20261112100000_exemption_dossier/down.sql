-- Retour arrière de 20261112100000_exemption_dossier (PL-205).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261112100000_exemption_dossier/down.sql
DROP TABLE IF EXISTS "ExemptionDossier";
DROP FUNCTION IF EXISTS exemption_dossier_guard();
DROP TYPE IF EXISTS "DossierStatus";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112100000_exemption_dossier';
