// PL-206 — Publie la bibliothèque de contrôles dans `ControlDefinition`. Idempotent ; à lancer à chaque déploiement.
// S'exécute sous le rôle de migration (DIRECT_DATABASE_URL) : le rôle applicatif n'écrit pas ce référentiel.
//
//   pnpm controls:sync
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { syncControlLibrary } from "@/server/system/control-library";

const connectionString = process.env.DIRECT_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DIRECT_DATABASE_URL manquant : la bibliothèque est publiée par le rôle de migration.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

syncControlLibrary(prisma)
  .then((report) => {
    console.log(
      `Bibliothèque ${report.libraryVersion} : ${report.created.length} créés, ` +
        `${report.updated.length} modifiés, ${report.deprecated.length} retirés, ${report.unchanged} inchangés.`,
    );
    if (report.updated.length > 0) console.log(`Contrôles modifiés : ${report.updated.join(", ")}`);
  })
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
