-- Retour arrière de 20261111090000_init (PL-102).
-- Généré par `prisma migrate diff --from-schema prisma/schema.prisma --to-empty --script`.
-- À exécuter avec le rôle de migration, jamais avec le rôle applicatif :
--   pnpm exec prisma db execute --file prisma/migrations/20261111090000_init/down.sql
-- Prisma n'exécute pas les retours arrière : la dernière instruction retire la migration de son historique.
-- Prérequis : avoir d'abord exécuté le down.sql des migrations postérieures, de la plus récente à la plus ancienne.

-- DropForeignKey
ALTER TABLE "public"."Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Member" DROP CONSTRAINT "Member_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Member" DROP CONSTRAINT "Member_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Invitation" DROP CONSTRAINT "Invitation_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AiSystem" DROP CONSTRAINT "AiSystem_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Classification" DROP CONSTRAINT "Classification_systemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DesignChange" DROP CONSTRAINT "DesignChange_systemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ControlInstance" DROP CONSTRAINT "ControlInstance_systemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ControlInstance" DROP CONSTRAINT "ControlInstance_definitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ControlEvaluation" DROP CONSTRAINT "ControlEvaluation_controlInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Integration" DROP CONSTRAINT "Integration_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."IntegrationResource" DROP CONSTRAINT "IntegrationResource_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SystemResourceLink" DROP CONSTRAINT "SystemResourceLink_systemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SystemResourceLink" DROP CONSTRAINT "SystemResourceLink_resourceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EvidenceItem" DROP CONSTRAINT "EvidenceItem_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EvidenceItem" DROP CONSTRAINT "EvidenceItem_resourceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EvidenceItem" DROP CONSTRAINT "EvidenceItem_sealBatchId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EvidenceLink" DROP CONSTRAINT "EvidenceLink_evidenceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EvidenceLink" DROP CONSTRAINT "EvidenceLink_controlInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SealBatch" DROP CONSTRAINT "SealBatch_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SealBatch" DROP CONSTRAINT "SealBatch_anchorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AuditPack" DROP CONSTRAINT "AuditPack_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AuditPack" DROP CONSTRAINT "AuditPack_systemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Subscription" DROP CONSTRAINT "Subscription_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OrgEncryptionKey" DROP CONSTRAINT "OrgEncryptionKey_orgId_fkey";

-- DropTable
DROP TABLE "public"."User";

-- DropTable
DROP TABLE "public"."Session";

-- DropTable
DROP TABLE "public"."Account";

-- DropTable
DROP TABLE "public"."Organization";

-- DropTable
DROP TABLE "public"."Member";

-- DropTable
DROP TABLE "public"."Invitation";

-- DropTable
DROP TABLE "public"."AiSystem";

-- DropTable
DROP TABLE "public"."Classification";

-- DropTable
DROP TABLE "public"."DesignChange";

-- DropTable
DROP TABLE "public"."ControlDefinition";

-- DropTable
DROP TABLE "public"."ControlInstance";

-- DropTable
DROP TABLE "public"."ControlEvaluation";

-- DropTable
DROP TABLE "public"."Integration";

-- DropTable
DROP TABLE "public"."IntegrationResource";

-- DropTable
DROP TABLE "public"."SystemResourceLink";

-- DropTable
DROP TABLE "public"."WebhookDelivery";

-- DropTable
DROP TABLE "public"."Job";

-- DropTable
DROP TABLE "public"."EvidenceItem";

-- DropTable
DROP TABLE "public"."EvidenceLink";

-- DropTable
DROP TABLE "public"."SealBatch";

-- DropTable
DROP TABLE "public"."Anchor";

-- DropTable
DROP TABLE "public"."SigningKey";

-- DropTable
DROP TABLE "public"."AuditPack";

-- DropTable
DROP TABLE "public"."AuditLog";

-- DropTable
DROP TABLE "public"."Notification";

-- DropTable
DROP TABLE "public"."RegulatoryUpdate";

-- DropTable
DROP TABLE "public"."Subscription";

-- DropTable
DROP TABLE "public"."ApiKey";

-- DropTable
DROP TABLE "public"."OrgEncryptionKey";

-- DropEnum
DROP TYPE "public"."OrgRole";

-- DropEnum
DROP TYPE "public"."AiActRole";

-- DropEnum
DROP TYPE "public"."RiskTier";

-- DropEnum
DROP TYPE "public"."SystemStatus";

-- DropEnum
DROP TYPE "public"."ClassificationStatus";

-- DropEnum
DROP TYPE "public"."AutomationLevel";

-- DropEnum
DROP TYPE "public"."ControlStatus";

-- DropEnum
DROP TYPE "public"."IntegrationProvider";

-- DropEnum
DROP TYPE "public"."IntegrationStatus";

-- DropEnum
DROP TYPE "public"."DeliveryStatus";

-- DropEnum
DROP TYPE "public"."JobStatus";

-- DropEnum
DROP TYPE "public"."EvidenceSource";

-- DropEnum
DROP TYPE "public"."CaptureMethod";

-- DropEnum
DROP TYPE "public"."PackStatus";

-- DropEnum
DROP TYPE "public"."Plan";


-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090000_init';
