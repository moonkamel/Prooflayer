// Prisma 7+ : les URL de connexion vivent ici (migrations) et dans l'adaptateur passé à PrismaClient
// (exécution), plus dans schema.prisma (voir §4.3.2 du cahier des charges).
//
// Deux connexions distinctes (PL-102, §4.3.3, §4.8) :
// - DIRECT_DATABASE_URL : rôle de migration, connexion directe (port 5432). Migrations, données de démonstration.
// - DATABASE_URL        : rôle applicatif prooflayer_app, pooler en mode transaction (port 6543). Exécution seule.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma validate` et `prisma generate` n'ouvrent aucune connexion : une valeur vide suffit pour eux.
    url: process.env.DIRECT_DATABASE_URL ?? "",
  },
});
