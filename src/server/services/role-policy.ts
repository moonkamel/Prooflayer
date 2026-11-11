// Règles d'attribution des rôles (§3.2 E10). Fonctions pures, testées dans tests/unit/role-policy.test.ts.
import type { OrgRole } from "@/generated/prisma/enums";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "contributor", "auditor"];

/** Rôles qui administrent l'organisation : membres, invitations, configuration. */
export const ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];

/**
 * Un admin gère les admins, contributeurs et auditeurs. Seul un owner touche au rôle owner :
 * le donner, le retirer, ou retirer de l'organisation un membre qui le détient.
 */
export function canAssignRole(
  actor: OrgRole,
  current: OrgRole | null,
  next: OrgRole | null,
): boolean {
  if (!ADMIN_ROLES.includes(actor)) return false;
  if (actor === "owner") return true;
  return current !== "owner" && next !== "owner";
}

/** L'organisation garde toujours au moins un owner. */
export function leavesAnOwner(owners: number, current: OrgRole, next: OrgRole | null): boolean {
  return !(current === "owner" && next !== "owner" && owners <= 1);
}
