// Session courante et garde d'accès de l'espace connecté (PL-103, PL-104).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type AuthSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { mustSetUpTwoFactor } from "./two-factor-policy";

export const SIGN_IN_PATH = "/sign-in";
export const TWO_FACTOR_SETUP_PATH = "/setup-two-factor";
export const ONBOARDING_PATH = "/onboarding";

export async function getCurrentSession(): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: await headers() });
}

/** Rôles de l'utilisateur dans toutes ses organisations. */
async function rolesOf(userId: string) {
  const members = await prisma.member.findMany({ where: { userId }, select: { role: true } });
  return members.map((m) => m.role);
}

export async function isTwoFactorSetupRequired(session: AuthSession): Promise<boolean> {
  return mustSetUpTwoFactor(await rolesOf(session.user.id), session.user.twoFactorEnabled === true);
}

export interface SessionSummary {
  id: string;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

/** Sessions ouvertes de l'utilisateur courant, sans leur jeton : rien de secret ne part vers le navigateur. */
export async function listOwnSessions(): Promise<SessionSummary[]> {
  const requestHeaders = await headers();
  const [current, sessions] = await Promise.all([
    auth.api.getSession({ headers: requestHeaders }),
    auth.api.listSessions({ headers: requestHeaders }),
  ]);
  return sessions
    .map((s) => ({
      id: s.id,
      createdAt: new Date(s.createdAt),
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
      current: s.id === current?.session.id,
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/** Ferme une session de l'utilisateur courant, désignée par son identifiant. Le jeton est retrouvé côté serveur. */
export async function revokeOwnSession(sessionId: string): Promise<void> {
  const requestHeaders = await headers();
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const target = sessions.find((s) => s.id === sessionId);
  if (!target) return; // Session déjà fermée ou appartenant à un autre utilisateur : rien à faire.
  await auth.api.revokeSession({ headers: requestHeaders, body: { token: target.token } });
}

export async function revokeOwnOtherSessions(): Promise<void> {
  await auth.api.revokeOtherSessions({ headers: await headers() });
}

/** Espace connecté : session obligatoire, puis 2FA obligatoire pour owner et admin. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  const roles = await rolesOf(session.user.id);
  // Sans organisation, l'espace connecté n'a pas de sens : création de l'organisation d'abord (§5.1).
  if (roles.length === 0) redirect(ONBOARDING_PATH);
  if (mustSetUpTwoFactor(roles, session.user.twoFactorEnabled === true))
    redirect(TWO_FACTOR_SETUP_PATH);
  return session;
}

/** Organisation active de la session : identifiant, ou null si aucune. */
export function activeOrganizationIdOf(session: AuthSession): string | null {
  return (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
}
