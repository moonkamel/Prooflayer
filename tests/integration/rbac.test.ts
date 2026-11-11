// PL-104 / §3.2 E10 : « pour chaque procédure de l'API, un rôle insuffisant reçoit FORBIDDEN ».
// Les procédures sont énumérées depuis le routeur : une procédure ajoutée plus tard est couverte sans modifier ce test.
// Base réelle (rôle applicatif) : la garde lit l'appartenance dans Member.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { appRouter, createCaller } from "@/server/routers/_app";
import { ORG_ROLES } from "@/server/services/role-policy";
import type { ProcedureMeta } from "@/server/trpc";

interface ProcedureInfo {
  path: string;
  type: "query" | "mutation" | "subscription";
  allowed: readonly OrgRole[];
}

// À l'exécution, _def.procedures est un dictionnaire plat « chemin → procédure » (le type déclaré est imbriqué).
type FlatProcedures = Record<
  string,
  { _def: { type: ProcedureInfo["type"]; meta?: ProcedureMeta } }
>;
const procedures: ProcedureInfo[] = Object.entries(
  appRouter._def.procedures as unknown as FlatProcedures,
).map(([path, procedure]) => ({
  path,
  type: procedure._def.type,
  allowed: procedure._def.meta?.roles ?? ORG_ROLES,
}));

const run = suffix();
function suffix() {
  return randomUUID().slice(0, 8);
}
const orgId = `org_rbac_${run}`;
const users: Record<OrgRole | "outsider", string> = {
  owner: `usr_rbac_owner_${run}`,
  admin: `usr_rbac_admin_${run}`,
  contributor: `usr_rbac_contributor_${run}`,
  auditor: `usr_rbac_auditor_${run}`,
  outsider: `usr_rbac_outsider_${run}`,
};

function callerFor(userId: string | null) {
  return createCaller({
    headers: new Headers(),
    session: userId ? { userId, activeOrganizationId: orgId } : null,
  });
}

/** Appelle une procédure par son chemin (« org.members.invite ») sans entrée : la garde de rôle passe avant la validation. */
function call(caller: ReturnType<typeof callerFor>, path: string): Promise<unknown> {
  const fn = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller);
  return (fn as (input?: unknown) => Promise<unknown>)(undefined);
}

async function expectCode(promise: Promise<unknown>, code: TRPCError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `attendu : ${code}`).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).code).toBe(code);
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: orgId, name: "RBAC", slug: orgId } });
  for (const [role, id] of Object.entries(users)) {
    await prisma.user.create({ data: { id, email: `${id}@rbac.test`, name: role } });
    if (role !== "outsider") {
      await prisma.member.create({
        data: { id: `mem_${id}`, organizationId: orgId, userId: id, role: role as OrgRole },
      });
    }
  }
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.$disconnect();
});

describe("inventaire des procédures", () => {
  it("le routeur expose des procédures", () => {
    expect(procedures.length).toBeGreaterThan(0);
  });

  it("toute mutation déclare explicitement ses rôles (withRole)", () => {
    const undeclared = procedures.filter((p) => p.type === "mutation" && p.allowed === ORG_ROLES);
    expect(undeclared.map((p) => p.path)).toEqual([]);
  });

  it("les écritures du routeur org exigent au moins admin (§4.4.2)", () => {
    for (const p of procedures.filter((p) => p.path.startsWith("org.") && p.type === "mutation")) {
      expect([...p.allowed].sort(), p.path).toEqual(["admin", "owner"]);
    }
  });
});

const insufficient = procedures.flatMap((p) =>
  ORG_ROLES.filter((role) => !p.allowed.includes(role)).map((role) => ({ ...p, role })),
);

describe("rôle insuffisant → FORBIDDEN", () => {
  it.each(insufficient)("$path refusé au rôle $role", async ({ path, role }) => {
    await expectCode(call(callerFor(users[role]), path), "FORBIDDEN");
  });
});

describe("hors de l'organisation et sans session", () => {
  it.each(procedures)("$path refusé à un non-membre (FORBIDDEN)", async ({ path }) => {
    await expectCode(call(callerFor(users.outsider), path), "FORBIDDEN");
  });

  it.each(procedures)("$path refusé sans session (UNAUTHORIZED)", async ({ path }) => {
    await expectCode(call(callerFor(null), path), "UNAUTHORIZED");
  });
});

describe("rôle suffisant : la garde laisse passer", () => {
  it("un auditor lit la liste des membres", async () => {
    const members = (await callerFor(users.auditor).org.members.list()) as { role: OrgRole }[];
    expect(members.map((m) => m.role).sort()).toEqual(["admin", "auditor", "contributor", "owner"]);
  });

  it("un admin dépasse la garde : l'entrée invalide est alors refusée par la validation (BAD_REQUEST)", async () => {
    await expectCode(call(callerFor(users.admin), "org.members.invite"), "BAD_REQUEST");
  });
});
