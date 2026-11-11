// tRPC (§4.4.1) : orgProcedure vérifie l'appartenance à l'organisation active ; withRole restreint par rôle.
// Les rôles autorisés sont aussi déclarés en métadonnées : tests/integration/rbac.test.ts les énumère pour
// vérifier qu'un rôle insuffisant reçoit FORBIDDEN sur chaque procédure (PL-104).
import { initTRPC, TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";
import type { OrgRole } from "@/generated/prisma/enums";
import type { Context } from "./context";
import { forOrg, prisma } from "./db";
import { ServiceError } from "./services/errors";

export interface ProcedureMeta {
  /** Rôles autorisés. Absent : tout membre de l'organisation active. */
  roles?: readonly OrgRole[];
}

const t = initTRPC.context<Context>().meta<ProcedureMeta>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const API_ERROR_CODES: Record<number, TRPCError["code"]> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "TOO_MANY_REQUESTS",
};

/** Traduit les erreurs de Better Auth et des services en erreurs tRPC, sans divulguer de détail interne. */
const errorTranslation = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof ServiceError) {
      throw new TRPCError({ code: cause.code, message: cause.reason, cause });
    }
    if (cause instanceof APIError) {
      throw new TRPCError({
        code: API_ERROR_CODES[cause.statusCode] ?? "INTERNAL_SERVER_ERROR",
        cause,
      });
    }
  }
  return result;
});

export const publicProcedure = t.procedure.use(errorTranslation);

export const orgProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const orgId = ctx.session?.activeOrganizationId;
  if (!ctx.session || !orgId) throw new TRPCError({ code: "UNAUTHORIZED" });

  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: ctx.session.userId } },
  });
  if (!member) throw new TRPCError({ code: "FORBIDDEN" });

  return next({
    ctx: { ...ctx, userId: ctx.session.userId, orgId, role: member.role, db: forOrg(orgId) },
  });
});

export const withRole = (...allowed: OrgRole[]) =>
  orgProcedure.meta({ roles: allowed }).use(({ ctx, next }) => {
    if (!allowed.includes(ctx.role)) throw new TRPCError({ code: "FORBIDDEN" });
    return next();
  });

export const adminProcedure = withRole("owner", "admin");
export const writeProcedure = withRole("owner", "admin", "contributor");
