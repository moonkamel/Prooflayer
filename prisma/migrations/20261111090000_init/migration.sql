-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'contributor', 'auditor');

-- CreateEnum
CREATE TYPE "AiActRole" AS ENUM ('PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('UNCLASSIFIED', 'NOT_AI_SYSTEM', 'OUT_OF_SCOPE', 'PROHIBITED', 'HIGH_RISK', 'HIGH_RISK_EXEMPT_ART6_3', 'LIMITED_TRANSPARENCY', 'MINIMAL');

-- CreateEnum
CREATE TYPE "SystemStatus" AS ENUM ('DESIGN', 'DEVELOPMENT', 'PRODUCTION', 'RETIRED');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('DRAFT', 'SIGNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AutomationLevel" AS ENUM ('AUTOMATED', 'SEMI_AUTOMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('PASS', 'FAIL', 'PARTIAL', 'STALE', 'MISSING', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'JIRA', 'GITLAB', 'NOTION', 'API');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'ERROR', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('GITHUB', 'JIRA', 'GITLAB', 'NOTION', 'MANUAL', 'API', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('WEBHOOK', 'BACKFILL', 'SNAPSHOT', 'UPLOAD', 'ATTESTATION', 'API');

-- CreateEnum
CREATE TYPE "PackStatus" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'STARTER', 'GROWTH', 'SCALE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activeOrganizationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "employeeBand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSystem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "intendedPurpose" TEXT NOT NULL,
    "description" TEXT,
    "role" "AiActRole" NOT NULL DEFAULT 'PROVIDER',
    "status" "SystemStatus" NOT NULL DEFAULT 'DEVELOPMENT',
    "riskTier" "RiskTier" NOT NULL DEFAULT 'UNCLASSIFIED',
    "annexIIIPoints" TEXT[],
    "placedOnMarketAt" TIMESTAMP(3),
    "ownerUserId" TEXT NOT NULL,
    "oversightOwnerUserId" TEXT,
    "vendorName" TEXT,
    "models" JSONB NOT NULL,
    "dataCategories" TEXT[],
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "classificationStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AiSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "tier" "RiskTier" NOT NULL,
    "role" "AiActRole" NOT NULL,
    "annexIIIPoints" TEXT[],
    "art63Conditions" TEXT[],
    "involvesProfiling" BOOLEAN NOT NULL DEFAULT false,
    "reasoning" JSONB NOT NULL,
    "status" "ClassificationStatus" NOT NULL DEFAULT 'DRAFT',
    "signedByUserId" TEXT,
    "signedByTitle" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignChange" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "isSignificant" BOOLEAN,
    "evidenceId" TEXT,
    "qualifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "libraryVersion" TEXT NOT NULL,
    "articleRef" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "statement" JSONB NOT NULL,
    "appliesToRoles" "AiActRole"[],
    "appliesToTiers" "RiskTier"[],
    "automation" "AutomationLevel" NOT NULL,
    "evidenceKinds" TEXT[],
    "freshnessDays" INTEGER,
    "evaluatorKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "deprecatedAt" TIMESTAMP(3),

    CONSTRAINT "ControlDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlInstance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" "ControlStatus" NOT NULL DEFAULT 'MISSING',
    "ownerUserId" TEXT,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "naJustification" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlEvaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "controlInstanceId" TEXT NOT NULL,
    "status" "ControlStatus" NOT NULL,
    "reasons" JSONB NOT NULL,
    "evidenceIds" TEXT[],
    "evaluatorVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalAccountName" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialsCiphertext" BYTEA,
    "scopes" TEXT[],
    "lastEventAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationResource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "syncCursor" TEXT,
    "lastSnapshotAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemResourceLink" (
    "systemId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pathGlobs" TEXT[],

    CONSTRAINT "SystemResourceLink_pkey" PRIMARY KEY ("systemId","resourceId")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orgId" TEXT,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "source" "EvidenceSource" NOT NULL,
    "capturedVia" "CaptureMethod" NOT NULL,
    "resourceId" TEXT,
    "sourceRef" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "actor" JSONB,
    "payload" JSONB,
    "contentSha256" BYTEA NOT NULL,
    "salt" BYTEA,
    "leafHash" BYTEA NOT NULL,
    "rawObjectKey" TEXT,
    "attachmentKey" TEXT,
    "attachmentSha256" BYTEA,
    "attachmentMime" TEXT,
    "declarative" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "sealBatchId" TEXT,
    "leafIndex" INTEGER,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "evidenceId" TEXT NOT NULL,
    "controlInstanceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL DEFAULT 'rule',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("evidenceId","controlInstanceId")
);

-- CreateTable
CREATE TABLE "SealBatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "merkleRoot" BYTEA NOT NULL,
    "prevBatchHash" BYTEA NOT NULL,
    "batchHash" BYTEA NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anchorId" TEXT,
    "anchorLeafIndex" INTEGER,

    CONSTRAINT "SealBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "batchCount" INTEGER NOT NULL,
    "merkleRoot" BYTEA NOT NULL,
    "prevAnchorHash" BYTEA NOT NULL,
    "anchorHash" BYTEA NOT NULL,
    "tsaName" TEXT NOT NULL,
    "tsaPolicyOid" TEXT NOT NULL,
    "tsaToken" BYTEA NOT NULL,
    "tsaGenTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "kid" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "publicKey" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("kid")
);

-- CreateTable
CREATE TABLE "AuditPack" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "status" "PackStatus" NOT NULL DEFAULT 'QUEUED',
    "objectKey" TEXT,
    "manifestSha256" BYTEA,
    "signature" BYTEA,
    "signingKid" TEXT,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastAnchorSeq" INTEGER,
    "shareTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryUpdate" (
    "id" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TIMESTAMP(3),
    "title" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "impactedControlKeys" TEXT[],
    "severity" TEXT NOT NULL,
    "libraryVersion" TEXT,

    CONSTRAINT "RegulatoryUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "monitoredSystemsLimit" INTEGER NOT NULL DEFAULT 1,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgEncryptionKey" (
    "orgId" TEXT NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "kekId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "OrgEncryptionKey_pkey" PRIMARY KEY ("orgId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Member_userId_idx" ON "Member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organizationId_userId_key" ON "Member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "AiSystem_orgId_riskTier_idx" ON "AiSystem"("orgId", "riskTier");

-- CreateIndex
CREATE UNIQUE INDEX "AiSystem_orgId_slug_key" ON "AiSystem"("orgId", "slug");

-- CreateIndex
CREATE INDEX "Classification_orgId_systemId_createdAt_idx" ON "Classification"("orgId", "systemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DesignChange_orgId_systemId_occurredAt_idx" ON "DesignChange"("orgId", "systemId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ControlDefinition_libraryVersion_pack_idx" ON "ControlDefinition"("libraryVersion", "pack");

-- CreateIndex
CREATE UNIQUE INDEX "ControlDefinition_key_libraryVersion_key" ON "ControlDefinition"("key", "libraryVersion");

-- CreateIndex
CREATE INDEX "ControlInstance_orgId_systemId_status_idx" ON "ControlInstance"("orgId", "systemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ControlInstance_systemId_definitionId_key" ON "ControlInstance"("systemId", "definitionId");

-- CreateIndex
CREATE INDEX "ControlEvaluation_controlInstanceId_evaluatedAt_idx" ON "ControlEvaluation"("controlInstanceId", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX "ControlEvaluation_orgId_evaluatedAt_idx" ON "ControlEvaluation"("orgId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "Integration_orgId_idx" ON "Integration"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_externalAccountId_key" ON "Integration"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "IntegrationResource_orgId_idx" ON "IntegrationResource"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationResource_integrationId_kind_externalId_key" ON "IntegrationResource"("integrationId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "SystemResourceLink_resourceId_idx" ON "SystemResourceLink"("resourceId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_provider_deliveryId_key" ON "WebhookDelivery"("provider", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "EvidenceItem_orgId_kind_occurredAt_idx" ON "EvidenceItem"("orgId", "kind", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "EvidenceItem_orgId_resourceId_occurredAt_idx" ON "EvidenceItem"("orgId", "resourceId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "EvidenceItem_orgId_sealBatchId_idx" ON "EvidenceItem"("orgId", "sealBatchId");

-- CreateIndex
CREATE INDEX "EvidenceItem_orgId_validUntil_idx" ON "EvidenceItem"("orgId", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_orgId_dedupeKey_key" ON "EvidenceItem"("orgId", "dedupeKey");

-- CreateIndex
CREATE INDEX "EvidenceLink_controlInstanceId_idx" ON "EvidenceLink"("controlInstanceId");

-- CreateIndex
CREATE INDEX "SealBatch_anchorId_idx" ON "SealBatch"("anchorId");

-- CreateIndex
CREATE UNIQUE INDEX "SealBatch_orgId_seq_key" ON "SealBatch"("orgId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_seq_key" ON "Anchor"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditPack_shareTokenHash_key" ON "AuditPack"("shareTokenHash");

-- CreateIndex
CREATE INDEX "AuditPack_orgId_systemId_createdAt_idx" ON "AuditPack"("orgId", "systemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_orgId_targetType_targetId_idx" ON "AuditLog"("orgId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Notification_orgId_userId_readAt_idx" ON "Notification"("orgId", "userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignChange" ADD CONSTRAINT "DesignChange_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlInstance" ADD CONSTRAINT "ControlInstance_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlInstance" ADD CONSTRAINT "ControlInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ControlDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlEvaluation" ADD CONSTRAINT "ControlEvaluation_controlInstanceId_fkey" FOREIGN KEY ("controlInstanceId") REFERENCES "ControlInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationResource" ADD CONSTRAINT "IntegrationResource_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemResourceLink" ADD CONSTRAINT "SystemResourceLink_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemResourceLink" ADD CONSTRAINT "SystemResourceLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "IntegrationResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "IntegrationResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_sealBatchId_fkey" FOREIGN KEY ("sealBatchId") REFERENCES "SealBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_controlInstanceId_fkey" FOREIGN KEY ("controlInstanceId") REFERENCES "ControlInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealBatch" ADD CONSTRAINT "SealBatch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealBatch" ADD CONSTRAINT "SealBatch_anchorId_fkey" FOREIGN KEY ("anchorId") REFERENCES "Anchor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPack" ADD CONSTRAINT "AuditPack_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPack" ADD CONSTRAINT "AuditPack_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgEncryptionKey" ADD CONSTRAINT "OrgEncryptionKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

