-- PL-608 : entonnoir d'activation (§1.4). Une ligne par organisation et par étape, à sa première occurrence.
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FunnelEvent_name_check" CHECK ("name" IN
      ('signup', 'classification_signed', 'connector_linked', 'first_evidence', 'first_pack'))
);
CREATE UNIQUE INDEX "FunnelEvent_orgId_name_key" ON "FunnelEvent"("orgId", "name");
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation entre organisations (convention de PL-105).
ALTER TABLE "FunnelEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FunnelEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FunnelEvent"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));
