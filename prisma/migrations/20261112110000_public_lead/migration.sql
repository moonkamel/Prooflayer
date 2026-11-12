-- PL-208 : demandes de note du classifieur public (§7.2). Table système sans organisation : pas de RLS (convention
-- de PL-105 pour les tables système) ; données de prospection dont ProofLayer est responsable de traitement (§8.2).
CREATE TABLE "PublicLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailDomain" TEXT NOT NULL,
    "contactConsent" BOOLEAN NOT NULL,
    "consentText" TEXT,
    "consentAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL,
    "systemName" TEXT,
    "responses" JSONB NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "tier" "RiskTier" NOT NULL,
    "role" "AiActRole" NOT NULL,
    "ipHash" TEXT NOT NULL,
    "noteSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicLead_email_createdAt_idx" ON "PublicLead"("email", "createdAt");
CREATE INDEX "PublicLead_ipHash_createdAt_idx" ON "PublicLead"("ipHash", "createdAt");
