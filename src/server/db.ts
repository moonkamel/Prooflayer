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

/**
 * Client restreint à une organisation (§4.3.3). Chaque requête s'exécute dans une transaction
 * qui positionne app.org_id, lu par les politiques RLS. Tout code métier passe par
 * forOrg() ; l'usage direct de `prisma` est réservé aux tables système et interdit par lint ailleurs.
 * Repris tel quel du §4.3.3 pour orgProcedure (PL-104) ; les politiques RLS et la règle de lint arrivent avec PL-105.
 */
export function forOrg(orgId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.org_id', ${orgId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type OrgTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Transaction interactive restreinte à une organisation (PL-204) : app.org_id est positionné pour toute la
 * transaction (RLS). Pour les écritures qui doivent réussir ou échouer ensemble, par exemple remplacer la
 * classification signée précédente et signer la nouvelle.
 */
export function withOrgTransaction<T>(orgId: string, fn: (tx: OrgTransaction) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, TRUE)`;
    return fn(tx);
  });
}
