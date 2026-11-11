import { describe, expect, it } from "vitest";
import { owner, admin, contributor, auditor } from "@/server/auth-roles";
import { canAssignRole, leavesAnOwner } from "@/server/services/role-policy";
import { slugify } from "@/server/services/organization";

describe("canAssignRole (§3.2 E10)", () => {
  it.each([
    // acteur, rôle actuel (null : invitation), nouveau rôle (null : retrait), attendu
    ["owner", null, "owner", true],
    ["owner", "owner", "admin", true],
    ["owner", "admin", null, true],
    ["admin", null, "admin", true],
    ["admin", null, "contributor", true],
    ["admin", "contributor", "auditor", true],
    ["admin", "auditor", null, true],
    ["admin", null, "owner", false],
    ["admin", "owner", "admin", false],
    ["admin", "owner", null, false],
    ["contributor", null, "auditor", false],
    ["contributor", "auditor", null, false],
    ["auditor", null, "auditor", false],
  ] as const)("%s : %s → %s = %s", (actor, current, next, expected) => {
    expect(canAssignRole(actor, current, next)).toBe(expected);
  });
});

describe("leavesAnOwner", () => {
  it("refuse de retirer ou rétrograder le dernier owner", () => {
    expect(leavesAnOwner(1, "owner", null)).toBe(false);
    expect(leavesAnOwner(1, "owner", "admin")).toBe(false);
  });
  it("accepte quand un autre owner reste", () => {
    expect(leavesAnOwner(2, "owner", null)).toBe(true);
  });
  it("n'est pas concerné par les autres rôles", () => {
    expect(leavesAnOwner(1, "admin", null)).toBe(true);
    expect(leavesAnOwner(1, "owner", "owner")).toBe(true);
  });
});

describe("droits Better Auth des quatre rôles", () => {
  type Authorizable = { authorize: (request: Record<string, string[]>) => { success: boolean } };
  const asRole = (role: unknown) => role as Authorizable;
  const canInvite = (role: unknown) => asRole(role).authorize({ invitation: ["create"] }).success;
  const canRemoveMember = (role: unknown) => asRole(role).authorize({ member: ["delete"] }).success;
  const canDeleteOrg = (role: unknown) =>
    asRole(role).authorize({ organization: ["delete"] }).success;

  it("owner : tout, dont la suppression de l'organisation", () => {
    expect([canInvite(owner), canRemoveMember(owner), canDeleteOrg(owner)]).toEqual([
      true,
      true,
      true,
    ]);
  });
  it("admin : membres et invitations, pas la suppression", () => {
    expect([canInvite(admin), canRemoveMember(admin), canDeleteOrg(admin)]).toEqual([
      true,
      true,
      false,
    ]);
  });
  it.each([
    ["contributor", contributor],
    ["auditor", auditor],
  ] as const)("%s : aucun droit sur l'organisation", (_, role) => {
    expect([canInvite(role), canRemoveMember(role), canDeleteOrg(role)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("slugify", () => {
  it.each([
    ["Talvio", "talvio"],
    ["Paylence SAS", "paylence-sas"],
    ["Écoles & Cie !", "ecoles-cie"],
    ["  --  ", "organisation"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
