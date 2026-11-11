// Accès aux tables d'identité gérées par Better Auth (User, Organization, Member, Invitation), sans colonne orgId,
// donc hors RLS. Seul endroit, avec src/server/db.ts et src/server/system/, où `prisma` est importé (PL-105) :
// chaque requête filtre explicitement sur l'organisation ou l'utilisateur concerné.
import type { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

/** Appartenance d'un utilisateur à une organisation (garde de orgProcedure, §4.4.1). */
export function findMembership(organizationId: string, userId: string) {
  return prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
}

/** Rôles de l'utilisateur dans toutes ses organisations. */
export async function rolesOfUser(userId: string): Promise<OrgRole[]> {
  const members = await prisma.member.findMany({ where: { userId }, select: { role: true } });
  return members.map((m) => m.role);
}

/** Organisation à ouvrir par défaut : la première rejointe. */
export async function firstOrganizationIdOf(userId: string): Promise<string | null> {
  const member = await prisma.member.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

export async function membershipsOfUser(userId: string) {
  const members = await prisma.member.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, organization: { select: { id: true, name: true } } },
  });
  return members.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }));
}

export function organizationById(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, country: true, employeeBand: true },
  });
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  return (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) !== null;
}

export function membersOf(organizationId: string) {
  return prisma.member.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, userId: true, user: { select: { name: true, email: true } } },
  });
}

export function memberInOrganization(organizationId: string, memberId: string) {
  return prisma.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true },
  });
}

export function countOwners(organizationId: string) {
  return prisma.member.count({ where: { organizationId, role: "owner" } });
}

export function pendingInvitationsOf(organizationId: string, now: Date) {
  return prisma.invitation.findMany({
    where: { organizationId, status: "pending", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
}

export function invitationInOrganization(organizationId: string, invitationId: string) {
  return prisma.invitation.findFirst({
    where: { id: invitationId, organizationId },
    select: { id: true },
  });
}

export function invitationById(invitationId: string) {
  return prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { email: true, status: true, expiresAt: true },
  });
}
