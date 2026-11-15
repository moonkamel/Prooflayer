-- PL-605 : limitation de débit sur l'authentification (Better Auth, stockage « database »), les webhooks et l'API.
-- Table système, sans organisation ni RLS ; une base commune vaut pour toutes les instances serverless.
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");
