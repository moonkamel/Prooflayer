-- PL-205 : dossier d'exemption de l'Art. 6(3) (Art. 6(4)), source des champs de l'Annexe VIII section B (Art. 49(2)).
CREATE TYPE "DossierStatus" AS ENUM ('DRAFT', 'SIGNED');

CREATE TABLE "ExemptionDossier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "status" "DossierStatus" NOT NULL DEFAULT 'DRAFT',
    "conditionJustification" TEXT NOT NULL,
    "profilingJustification" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerAddress" TEXT NOT NULL,
    "providerContact" TEXT NOT NULL,
    "submitter" TEXT,
    "representative" TEXT,
    "tradeName" TEXT NOT NULL,
    "memberStates" TEXT[],
    "signedByUserId" TEXT,
    "signedByName" TEXT,
    "signedByTitle" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExemptionDossier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExemptionDossier_classificationId_key" ON "ExemptionDossier"("classificationId");
CREATE INDEX "ExemptionDossier_orgId_systemId_idx" ON "ExemptionDossier"("orgId", "systemId");

ALTER TABLE "ExemptionDossier" ADD CONSTRAINT "ExemptionDossier_systemId_fkey"
  FOREIGN KEY ("systemId") REFERENCES "AiSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExemptionDossier" ADD CONSTRAINT "ExemptionDossier_classificationId_fkey"
  FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation entre organisations (convention de PL-105).
ALTER TABLE "ExemptionDossier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExemptionDossier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExemptionDossier"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- Un dossier signé ne change plus et ne se supprime qu'à la purge de l'organisation (modèle de classification_guard).
CREATE OR REPLACE FUNCTION exemption_dossier_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR current_setting('app.purge_org', true) = OLD."orgId" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Dossier d''exemption signé : suppression interdite';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Dossier d''exemption signé : aucune modification';
END $$;

CREATE TRIGGER exemption_dossier_guard
  BEFORE UPDATE OR DELETE ON "ExemptionDossier"
  FOR EACH ROW EXECUTE FUNCTION exemption_dossier_guard();
