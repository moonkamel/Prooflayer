// Adaptateur de base de Better Auth : tables d'identité, sans orgId, hors RLS (PL-105 : `prisma` réservé à system/).
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/server/db";

export const authDatabase = prismaAdapter(prisma, { provider: "postgresql" });
