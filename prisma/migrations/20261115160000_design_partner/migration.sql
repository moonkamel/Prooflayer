-- PL-610 : design partners (§7.5). Table système (sans RLS, comme Job) tenue par le fondateur ; supprimée avec
-- l'organisation (clé étrangère en cascade, donc par purge_organization).
CREATE TABLE "DesignPartner" (
    "orgId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "pilotStartedAt" TIMESTAMP(3) NOT NULL,
    "sessionAt" TIMESTAMP(3),
    "packSharedAt" TIMESTAMP(3),
    "packAudience" TEXT,
    "replacedAt" TIMESTAMP(3),
    CONSTRAINT "DesignPartner_pkey" PRIMARY KEY ("orgId"),
    CONSTRAINT "DesignPartner_segment_check" CHECK ("segment" IN ('hr_tech', 'fintech', 'exemption')),
    CONSTRAINT "DesignPartner_audience_check"
      CHECK ("packAudience" IS NULL OR "packAudience" IN ('client', 'investor', 'auditor'))
);
ALTER TABLE "DesignPartner" ADD CONSTRAINT "DesignPartner_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
