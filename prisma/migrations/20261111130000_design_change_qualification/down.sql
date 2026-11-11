-- Retour arrière de 20261111130000_design_change_qualification (PL-201).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111130000_design_change_qualification/down.sql
ALTER TABLE "DesignChange" DROP COLUMN "qualificationReason";
ALTER TABLE "DesignChange" DROP COLUMN "qualifiedAt";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111130000_design_change_qualification';
