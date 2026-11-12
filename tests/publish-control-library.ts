// Publie la bibliothèque de contrôles avant les tests d'intégration et e2e (PL-207 : la signature d'une
// classification crée les contrôles à partir de `ControlDefinition`). Rôle de migration, idempotent.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { syncControlLibrary } from "@/server/system/control-library";

export default async function publishControlLibrary(): Promise<void> {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString)
    throw new Error("DIRECT_DATABASE_URL manquant pour publier la bibliothèque.");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await syncControlLibrary(client);
  } finally {
    await client.$disconnect();
  }
}
