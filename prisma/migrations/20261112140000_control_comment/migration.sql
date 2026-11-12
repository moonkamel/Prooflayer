-- PL-407 : commentaires d'un contrôle (§5.3 écran D, action « commenter » ; rôle contributor du §3.1).
-- En ajout seul : le rôle applicatif ne modifie ni ne supprime un commentaire ; seule la suppression du contrôle
-- (purge de l'organisation) les emporte.
CREATE TABLE "ControlComment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "controlInstanceId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlComment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ControlComment_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000)
);

CREATE INDEX "ControlComment_controlInstanceId_createdAt_idx" ON "ControlComment"("controlInstanceId", "createdAt");

ALTER TABLE "ControlComment" ADD CONSTRAINT "ControlComment_controlInstanceId_fkey"
  FOREIGN KEY ("controlInstanceId") REFERENCES "ControlInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation entre organisations (convention de PL-105).
ALTER TABLE "ControlComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ControlComment"
  USING ("orgId" = current_setting('app.org_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

REVOKE UPDATE, DELETE ON "ControlComment" FROM prooflayer_app;
