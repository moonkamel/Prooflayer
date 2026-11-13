-- PL-408 : préférences de notification par utilisateur et par organisation (§3.2 E12, routeur `notification` du
-- §4.4.2 : preferences.get / preferences.set). Sans ligne, les deux envois sont actifs.
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "controlFailedEmail" BOOLEAN NOT NULL DEFAULT true,
    "dailyDigestEmail" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_orgId_userId_key" ON "NotificationPreference"("orgId", "userId");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation entre organisations (convention de PL-105).
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationPreference"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));
