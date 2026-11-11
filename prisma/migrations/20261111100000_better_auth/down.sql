-- Retour arrière de 20261111100000_better_auth (PL-103).
-- Généré par `prisma migrate diff` du schéma de PL-103 vers celui de PL-102.
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261111100000_better_auth/down.sql
-- Détruit les jetons de vérification et les secrets de double authentification.

-- DropForeignKey
ALTER TABLE "TwoFactor" DROP CONSTRAINT "TwoFactor_userId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_inviterId_fkey";

-- DropIndex
DROP INDEX "Account_userId_idx";

-- DropIndex
DROP INDEX "Member_organizationId_idx";

-- DropIndex
DROP INDEX "Invitation_email_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "image";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "accessTokenExpiresAt",
DROP COLUMN "idToken",
DROP COLUMN "refreshToken",
DROP COLUMN "refreshTokenExpiresAt",
DROP COLUMN "scope",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "logo",
DROP COLUMN "metadata";

-- AlterTable
ALTER TABLE "Invitation" DROP COLUMN "createdAt";

-- DropTable
DROP TABLE "Verification";

-- DropTable
DROP TABLE "TwoFactor";


-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111100000_better_auth';
