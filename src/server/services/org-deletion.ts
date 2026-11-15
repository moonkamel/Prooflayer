// PL-607 — Suppression d'une organisation par un owner (« purge programmée, clé de chiffrement détruite,
// confirmation par email »). La demande se confirme par le mot de passe (essais limités, sign-guard) et le
// slug de l'organisation ; la purge a lieu DELETION_GRACE_DAYS plus tard, annulable d'ici là. Un abonnement payant
// encore actif doit d'abord être résilié (portail de facturation) : on ne laisse pas un prélèvement sans service.
import { organizationById } from "@/server/system/identity";
import {
  cancelPendingDeletion,
  DELETION_GRACE_DAYS,
  pendingDeletion,
  scheduleDeletion,
} from "@/server/system/org-deletion";
import { scheduleDeletionNotice } from "@/server/system/jobs/org-deletion";
import { withOrgTransaction } from "@/server/db";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";
import { assertSignAttemptsLeft, type SignDependencies } from "./sign-guard";

const DAY_MS = 86_400_000;

export interface DeletionDependencies extends SignDependencies {
  notify: (deletionId: string) => Promise<unknown>;
  now: () => Date;
}

const meta = (ctx: OrgContext) => ({
  orgId: ctx.orgId,
  actor: { type: "user" as const, id: ctx.userId },
  ipAddress: clientIp(ctx.headers),
  db: ctx.db,
});

const view = (d: { reason: string; requestedAt: Date; scheduledFor: Date } | null) =>
  d
    ? {
        reason: d.reason as "owner_request" | "contract_end",
        requestedAt: d.requestedAt.toISOString(),
        scheduledFor: d.scheduledFor.toISOString(),
      }
    : null;

export async function getDeletion(ctx: OrgContext) {
  return view(await pendingDeletion(ctx.orgId));
}

export async function requestDeletion(
  ctx: OrgContext,
  input: { password: string; confirmation: string },
  deps: DeletionDependencies,
) {
  const organization = await organizationById(ctx.orgId);
  if (!organization) throw new ServiceError("NOT_FOUND", "organization.notFound");
  if (await pendingDeletion(ctx.orgId))
    throw new ServiceError("CONFLICT", "deletion.alreadyScheduled");
  if (input.confirmation.trim() !== organization.slug) {
    throw new ServiceError("BAD_REQUEST", "deletion.confirmationMismatch");
  }
  const subscription = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.subscription.findUnique({ where: { orgId: ctx.orgId } }),
  );
  if (
    subscription?.stripeSubscriptionId &&
    ["active", "trialing", "past_due"].includes(subscription.status) &&
    !subscription.cancelAtPeriodEnd
  ) {
    throw new ServiceError("CONFLICT", "deletion.activeSubscription");
  }
  await assertSignAttemptsLeft(ctx);
  if (!(await deps.verifyPassword(input.password))) {
    await audit(meta(ctx), "org.deletionRefused", { type: "organization", id: ctx.orgId }, {});
    throw new ServiceError("FORBIDDEN", "classification.invalidPassword");
  }
  const scheduledFor = new Date(deps.now().getTime() + DELETION_GRACE_DAYS * DAY_MS);
  const deletion = await scheduleDeletion({
    orgId: ctx.orgId,
    reason: "owner_request",
    requestedByUserId: ctx.userId,
    scheduledFor,
  });
  await audit(
    meta(ctx),
    "org.deletionRequest",
    { type: "organization", id: ctx.orgId },
    {
      scheduledFor: scheduledFor.toISOString(),
    },
  );
  await deps.notify(deletion.id);
  return view({ reason: "owner_request", requestedAt: deps.now(), scheduledFor });
}

export async function cancelDeletion(ctx: OrgContext, now = new Date()) {
  const pending = await pendingDeletion(ctx.orgId);
  if (!pending) throw new ServiceError("NOT_FOUND", "deletion.notScheduled");
  await cancelPendingDeletion(ctx.orgId, now);
  await audit(
    meta(ctx),
    "org.deletionCancel",
    { type: "organization", id: ctx.orgId },
    {
      reason: pending.reason,
    },
  );
  return { cancelled: true };
}

export const defaultDeletionNotify = scheduleDeletionNotice;
