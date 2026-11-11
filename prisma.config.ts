// Prisma 7+ : les URL de connexion vivent ici (migrations) et dans l'adaptateur passé à PrismaClient
// (exécution), plus dans schema.prisma (voir §4.3.2 du cahier des charges).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Pas de base à ce stade (PL-102). `prisma validate` n'ouvre aucune connexion.
    url: process.env.DATABASE_URL ?? "",
  },
});
