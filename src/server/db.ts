// Client Prisma d'exécution (§4.3.3). Connexion sous le rôle applicatif prooflayer_app (DATABASE_URL, pooler).
//
// PL-105 ajoutera forOrg(orgId) ; tout accès aux données métier passera alors par lui, et une règle de lint
// réservera `prisma` à src/server/system/ et à ce fichier. Les tables d'identité gérées par Better Auth
// (User, Session, Account, Verification, TwoFactor) ne portent pas d'orgId : l'adaptateur de Better Auth les lit ici.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // La connexion n'est ouverte qu'à la première requête : le build n'a pas besoin de DATABASE_URL.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

// Une seule instance par processus, y compris sous le rechargement à chaud de `next dev`.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
