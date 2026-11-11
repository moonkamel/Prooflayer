// Organisations, membres et invitations (PL-104, §3.2 E10). Les écritures passent par Better Auth, qui applique
// aussi son contrôle d'accès ; les règles propres à ProofLayer (rôle owner, dernier owner) sont vérifiées ici d'abord.
// Member et Invitation sont des tables d'identité gérées par Better Auth, sans colonne orgId : elles sont lues par
// src/server/system/identity.ts, filtrées explicitement sur l'organisation active.
import { auth } from "@/server/auth";
import type { forOrg } from "@/server/db";
import * as identity from "@/server/system/identity";
import type { OrgRole } from "@/generated/prisma/enums";
import { audit, clientIp, type AuditAction, type AuditTarget } from "./audit";
import { ServiceError } from "./errors";
import { canAssignRole, leavesAnOwner } from "./role-policy";

export interface OrgContext {
  headers: Headers;
  userId: string;
  orgId: string;
  role: OrgRole;
  /** Connexion de l'organisation (forOrg), fournie par orgProcedure. */
  db?: ReturnType<typeof forOrg>;
}

/** Inscription au journal d'audit d'une écriture faite par l'utilisateur courant (PL-106). */
function record(
  ctx: OrgContext,
  action: AuditAction,
  target: AuditTarget,
  metadata: Record<string, unknown> = {},
) {
  return audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    action,
    target,
    metadata,
  );
}

export async function getOrganization(ctx: OrgContext) {
  const org = await identity.organizationById(ctx.orgId);
  if (!org) throw new ServiceError("NOT_FOUND", "organization.notFound");
  return { ...org, role: ctx.role };
}

export async function updateOrganization(ctx: OrgContext, input: { name: string }) {
  await auth.api.updateOrganization({
    headers: ctx.headers,
    body: { organizationId: ctx.orgId, data: { name: input.name } },
  });
  await record(
    ctx,
    "organization.update",
    { type: "organization", id: ctx.orgId },
    { name: input.name },
  );
}

export async function listMembers(ctx: OrgContext) {
  const members = await identity.membersOf(ctx.orgId);
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    name: m.user.name,
    email: m.user.email,
    isCurrentUser: m.userId === ctx.userId,
  }));
}

async function findMember(ctx: OrgContext, memberId: string) {
  const member = await identity.memberInOrganization(ctx.orgId, memberId);
  if (!member) throw new ServiceError("NOT_FOUND", "member.notFound");
  return member;
}

export async function inviteMember(ctx: OrgContext, input: { email: string; role: OrgRole }) {
  if (!canAssignRole(ctx.role, null, input.role))
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  await auth.api.createInvitation({
    headers: ctx.headers,
    body: { email: input.email, role: input.role, organizationId: ctx.orgId },
  });
  await record(
    ctx,
    "member.invite",
    { type: "invitation", id: input.email },
    { email: input.email, role: input.role },
  );
}

export async function setMemberRole(ctx: OrgContext, input: { memberId: string; role: OrgRole }) {
  const target = await findMember(ctx, input.memberId);
  if (!canAssignRole(ctx.role, target.role, input.role)) {
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  }
  if (!leavesAnOwner(await identity.countOwners(ctx.orgId), target.role, input.role)) {
    throw new ServiceError("CONFLICT", "role.lastOwner");
  }
  await auth.api.updateMemberRole({
    headers: ctx.headers,
    body: { memberId: target.id, role: input.role, organizationId: ctx.orgId },
  });
  await record(
    ctx,
    "member.setRole",
    { type: "member", id: target.id },
    { from: target.role, to: input.role },
  );
}

export async function removeMember(ctx: OrgContext, input: { memberId: string }) {
  const target = await findMember(ctx, input.memberId);
  if (!canAssignRole(ctx.role, target.role, null))
    throw new ServiceError("FORBIDDEN", "role.forbidden");
  if (!leavesAnOwner(await identity.countOwners(ctx.orgId), target.role, null)) {
    throw new ServiceError("CONFLICT", "role.lastOwner");
  }
  await auth.api.removeMember({
    headers: ctx.headers,
    body: { memberIdOrEmail: target.id, organizationId: ctx.orgId },
  });
  await record(ctx, "member.remove", { type: "member", id: target.id }, { role: target.role });
}

export async function listPendingInvitations(ctx: OrgContext) {
  const invitations = await identity.pendingInvitationsOf(ctx.orgId, new Date());
  return invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }));
}

export async function revokeInvitation(ctx: OrgContext, input: { invitationId: string }) {
  const invitation = await identity.invitationInOrganization(ctx.orgId, input.invitationId);
  if (!invitation) throw new ServiceError("NOT_FOUND", "invitation.notFound");
  await auth.api.cancelInvitation({ headers: ctx.headers, body: { invitationId: invitation.id } });
  await record(ctx, "invitation.revoke", { type: "invitation", id: invitation.id });
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
    if (!(await identity.isSlugTaken(slug))) return slug;
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
  return identity.membershipsOfUser(userId);
}

export type InvitationCheck = "valid" | "invalid" | "wrongAccount";

/** État d'une invitation pour l'utilisateur connecté, avant acceptation (Better Auth revérifie à l'acceptation). */
export async function checkInvitationFor(
  invitationId: string,
  email: string,
): Promise<InvitationCheck> {
  const invitation = await identity.invitationById(invitationId);
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
    return "invalid";
  }
  return invitation.email.toLowerCase() === email.toLowerCase() ? "valid" : "wrongAccount";
}
