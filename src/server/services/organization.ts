// Organisations, membres et invitations (PL-104, §3.2 E10). Les écritures passent par Better Auth, qui applique
// aussi son contrôle d'accès ; les règles propres à ProofLayer (rôle owner, dernier owner) sont vérifiées ici d'abord.
// Member et Invitation sont des tables d'identité gérées par Better Auth, sans colonne orgId : elles sont lues par
// `prisma`, filtrées explicitement sur l'organisation active.
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import type { OrgRole } from "@/generated/prisma/enums";
import { ServiceError } from "./errors";
import { canAssignRole, leavesAnOwner } from "./role-policy";

export interface OrgContext {
  headers: Headers;
  userId: string;
  orgId: string;
  role: OrgRole;
}

export async function getOrganization(ctx: OrgContext) {
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { id: true, name: true, slug: true, country: true, employeeBand: true },
  });
  if (!org) throw new ServiceError("NOT_FOUND", "organization.notFound");
  return { ...org, role: ctx.role };
}

export async function updateOrganization(ctx: OrgContext, input: { name: string }) {
  await auth.api.updateOrganization({
    headers: ctx.headers,
    body: { organizationId: ctx.orgId, data: { name: input.name } },
  });
}

export async function listMembers(ctx: OrgContext) {
  const members = await prisma.member.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, userId: true, user: { select: { name: true, email: true } } },
  });
  return members.map((m) => ({
    id: m.id,
    role: m.role,
    name: m.user.name,
    email: m.user.email,
    isCurrentUser: m.userId === ctx.userId,
  }));
}

async function findMember(ctx: OrgContext, memberId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: ctx.orgId },
    select: { id: true, role: true },
  });
  if (!member) throw new ServiceError("NOT_FOUND", "member.notFound");
  return member;
}

const countOwners = (orgId: string) =>
  prisma.member.count({ where: { organizationId: orgId, role: "owner" } });

export async function inviteMember(ctx: OrgContext, input: { email: string; role: OrgRole }) {
  if (!canAssignRole(ctx.role, null, input.role))
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  await auth.api.createInvitation({
    headers: ctx.headers,
    body: { email: input.email, role: input.role, organizationId: ctx.orgId },
  });
}

export async function setMemberRole(ctx: OrgContext, input: { memberId: string; role: OrgRole }) {
  const target = await findMember(ctx, input.memberId);
  if (!canAssignRole(ctx.role, target.role, input.role)) {
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  }
  if (!leavesAnOwner(await countOwners(ctx.orgId), target.role, input.role)) {
    throw new ServiceError("CONFLICT", "role.lastOwner");
  }
  await auth.api.updateMemberRole({
    headers: ctx.headers,
    body: { memberId: target.id, role: input.role, organizationId: ctx.orgId },
  });
}

export async function removeMember(ctx: OrgContext, input: { memberId: string }) {
  const target = await findMember(ctx, input.memberId);
  if (!canAssignRole(ctx.role, target.role, null))
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  if (!leavesAnOwner(await countOwners(ctx.orgId), target.role, null)) {
    throw new ServiceError("CONFLICT", "role.lastOwner");
  }
  await auth.api.removeMember({
    headers: ctx.headers,
    body: { memberIdOrEmail: target.id, organizationId: ctx.orgId },
  });
}

export async function listPendingInvitations(ctx: OrgContext) {
  const invitations = await prisma.invitation.findMany({
    where: { organizationId: ctx.orgId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  return invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }));
}

export async function revokeInvitation(ctx: OrgContext, input: { invitationId: string }) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: input.invitationId, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!invitation) throw new ServiceError("NOT_FOUND", "invitation.notFound");
  await auth.api.cancelInvitation({ headers: ctx.headers, body: { invitationId: invitation.id } });
}

/** Identifiant d'URL lisible et unique, dérivé du nom (« Talvio SAS » → « talvio-sas », puis « talvio-sas-2 »…). */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return base || "organisation";
}

async function availableSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; n < 100; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.organization.findUnique({ where: { slug }, select: { id: true } })))
      return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Création à l'issue de l'inscription (§5.1, écran 1) : l'utilisateur en devient owner et l'organisation devient active. */
export async function createOrganizationForCurrentUser(headers: Headers, input: { name: string }) {
  const created = await auth.api.createOrganization({
    headers,
    body: { name: input.name, slug: await availableSlug(input.name) },
  });
  if (!created) throw new ServiceError("BAD_REQUEST", "organization.notCreated");
  return { id: created.id };
}

/** Organisations dont l'utilisateur est membre, pour le changement d'organisation active. */
export async function listOwnMemberships(userId: string) {
  const members = await prisma.member.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, organization: { select: { id: true, name: true } } },
  });
  return members.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }));
}

export type InvitationCheck = "valid" | "invalid" | "wrongAccount";

/** État d'une invitation pour l'utilisateur connecté, avant acceptation (Better Auth revérifie à l'acceptation). */
export async function checkInvitationFor(
  invitationId: string,
  email: string,
): Promise<InvitationCheck> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { email: true, status: true, expiresAt: true },
  });
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
    return "invalid";
  }
  return invitation.email.toLowerCase() === email.toLowerCase() ? "valid" : "wrongAccount";
}
