// Double authentification obligatoire pour owner et admin (§3.2 E10, §4.7, PL-103).
// Fonction pure : la lecture des rôles et de l'état 2FA se fait dans services/session.ts.
import type { OrgRole } from "@/generated/prisma/enums";

export const ROLES_REQUIRING_TWO_FACTOR: readonly OrgRole[] = ["owner", "admin"];

/** Vrai si l'utilisateur a au moins un rôle owner ou admin, dans n'importe quelle organisation, sans 2FA active. */
export function mustSetUpTwoFactor(roles: readonly OrgRole[], twoFactorEnabled: boolean): boolean {
  return !twoFactorEnabled && roles.some((role) => ROLES_REQUIRING_TWO_FACTOR.includes(role));
}
