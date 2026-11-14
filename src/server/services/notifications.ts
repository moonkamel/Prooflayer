// Alertes (PL-408, §3.2 E12, routeur `notification` du §4.4.2) :
// - régression d'un contrôle (PASS → FAIL) : une Notification pour le responsable du contrôle, à défaut le responsable
//   du système, et un email immédiat (job `notification.email`, idempotent par `emailedAt`) ;
// - résumé quotidien : au plus un email par jour et par utilisateur, toutes organisations réunies (job
//   `notification.digest`), marqué par une Notification `digest.daily` dans chaque organisation reprise ;
// - préférences par utilisateur et par organisation, liste des alertes et lecture.
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import type { ControlStatus } from "@/generated/prisma/enums";
import type { Evaluation } from "@/server/rules/evaluation";
import { createEmailTransport, type EmailTransport } from "@/server/email/transport";
import {
  renderControlFailedEmail,
  renderDigestEmail,
  renderPackReadyEmail,
} from "@/server/email/notification-emails";
import { membershipsOfUser, userContact } from "@/server/system/identity";
import { audit, clientIp } from "./audit";
import {
  digestForUser,
  expiryWindow,
  isRegression,
  type DigestFacts,
  type OrgDigest,
} from "./notifications-data";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

export interface NotificationDependencies {
  transport: EmailTransport;
  baseUrl: string;
  now: () => Date;
}

export function defaultNotificationDependencies(): NotificationDependencies {
  return {
    transport: createEmailTransport(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    now: () => new Date(),
  };
}

/** Programme l'email d'une notification ; fourni par la file de jobs (évite une dépendance circulaire). */
export type ScheduleNotificationEmail = (
  tx: OrgTransaction,
  orgId: string,
  notificationId: string,
) => Promise<unknown>;

interface ControlFailedPayload {
  controlInstanceId: string;
  controlKey: string;
  systemId: string;
  reasons: { fr: string; en: string }[];
}

/**
 * Régression PASS → FAIL : alerte le responsable du contrôle (à défaut, celui du système). Appelé dans la
 * transaction de l'évaluation : l'alerte et l'évaluation existent ensemble ou pas du tout.
 */
export async function notifyRegression(
  tx: OrgTransaction,
  input: {
    orgId: string;
    controlInstanceId: string;
    previous: ControlStatus;
    evaluation: Evaluation;
  },
  schedule: ScheduleNotificationEmail,
): Promise<string | null> {
  if (!isRegression(input.previous, input.evaluation.status)) return null;
  const instance = await tx.controlInstance.findUnique({
    where: { id: input.controlInstanceId },
    select: {
      ownerUserId: true,
      systemId: true,
      definition: { select: { key: true } },
      system: { select: { ownerUserId: true } },
    },
  });
  const userId = instance?.ownerUserId ?? instance?.system.ownerUserId;
  if (!instance || !userId) return null;
  const payload: ControlFailedPayload = {
    controlInstanceId: input.controlInstanceId,
    controlKey: instance.definition.key,
    systemId: instance.systemId,
    reasons: input.evaluation.reasons.map((r) => r.message),
  };
  const notification = await tx.notification.create({
    data: { orgId: input.orgId, userId, type: "control.failed", payload: payload as object },
  });
  await schedule(tx, input.orgId, notification.id);
  return notification.id;
}

interface PackReadyPayload {
  packId: string;
  systemId: string;
  systemName: string;
  evidenceCount: number;
}

/** Pack prêt (PL-504, §3.2 E9 « notification par email à la fin ») : alerte au demandeur et email. */
export async function notifyPackReady(
  tx: OrgTransaction,
  orgId: string,
  input: PackReadyPayload & { userId: string },
  schedule: ScheduleNotificationEmail,
) {
  const { userId, ...payload } = input;
  const notification = await tx.notification.create({
    data: { orgId, userId, type: "pack.ready", payload: payload as object },
  });
  await schedule(tx, orgId, notification.id);
  return notification.id;
}

async function preferencesOf(tx: OrgTransaction, orgId: string, userId: string) {
  const row = await tx.notificationPreference.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  return {
    controlFailedEmail: row?.controlFailedEmail ?? true,
    dailyDigestEmail: row?.dailyDigestEmail ?? true,
  };
}

/** Job `notification.email` : envoie l'email d'une alerte de régression, une seule fois. */
export async function sendNotificationEmail(
  tx: OrgTransaction,
  orgId: string,
  notificationId: string,
  deps: NotificationDependencies = defaultNotificationDependencies(),
): Promise<"sent" | "skipped"> {
  const notification = await tx.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.orgId !== orgId || notification.emailedAt) return "skipped";
  if (notification.type === "pack.ready") return sendPackReadyEmail(tx, notification, deps);
  if (notification.type !== "control.failed") return "skipped";
  const memberships = await membershipsOfUser(notification.userId);
  const organization = memberships.find((m) => m.id === orgId);
  const prefs = await preferencesOf(tx, orgId, notification.userId);
  const payload = notification.payload as unknown as ControlFailedPayload;
  const instance = await tx.controlInstance.findUnique({
    where: { id: payload.controlInstanceId },
    select: {
      status: true,
      notApplicable: true,
      definition: { select: { title: true } },
      system: { select: { id: true, name: true, archivedAt: true } },
    },
  });
  const user = await userContact(notification.userId);
  // Ancien membre, préférence désactivée, contrôle déjà rétabli ou système archivé : pas d'email.
  if (
    !organization ||
    !user ||
    !prefs.controlFailedEmail ||
    !instance ||
    instance.notApplicable ||
    instance.system.archivedAt ||
    instance.status !== "FAIL"
  ) {
    return "skipped";
  }
  await deps.transport.send(
    await renderControlFailedEmail({
      to: user.email,
      name: user.name,
      locale: user.locale,
      baseUrl: deps.baseUrl,
      organization: organization.name,
      system: { id: instance.system.id, name: instance.system.name },
      control: {
        id: payload.controlInstanceId,
        key: payload.controlKey,
        title: instance.definition.title as { fr: string; en: string },
      },
      reasons: payload.reasons,
    }),
  );
  await tx.notification.update({
    where: { id: notification.id },
    data: { emailedAt: deps.now() },
  });
  return "sent";
}

/** Email « pack prêt » : toujours envoyé au demandeur encore membre (il l'a demandé, ce n'est pas une alerte). */
async function sendPackReadyEmail(
  tx: OrgTransaction,
  notification: { id: string; orgId: string; userId: string; payload: unknown },
  deps: NotificationDependencies,
): Promise<"sent" | "skipped"> {
  const memberships = await membershipsOfUser(notification.userId);
  const organization = memberships.find((m) => m.id === notification.orgId);
  const user = await userContact(notification.userId);
  if (!organization || !user) return "skipped";
  const payload = notification.payload as PackReadyPayload;
  await deps.transport.send(
    await renderPackReadyEmail({
      to: user.email,
      name: user.name,
      locale: user.locale,
      baseUrl: deps.baseUrl,
      organization: organization.name,
      system: { id: payload.systemId, name: payload.systemName },
      evidenceCount: payload.evidenceCount,
    }),
  );
  await tx.notification.update({ where: { id: notification.id }, data: { emailedAt: deps.now() } });
  return "sent";
}

async function digestFacts(tx: OrgTransaction, now: Date): Promise<DigestFacts> {
  const { from, to } = expiryWindow(now);
  const [links, integrations, stale] = await Promise.all([
    tx.evidenceLink.findMany({
      where: {
        evidence: { validUntil: { gt: from, lte: to }, redactedAt: null },
        controlInstance: { notApplicable: false, system: { archivedAt: null } },
      },
      select: {
        evidence: { select: { summary: true, validUntil: true } },
        controlInstance: {
          select: {
            id: true,
            ownerUserId: true,
            definition: { select: { key: true } },
            system: { select: { id: true, name: true, ownerUserId: true } },
          },
        },
      },
    }),
    tx.integration.findMany({ select: { provider: true, status: true } }),
    tx.aiSystem.findMany({
      where: { classificationStale: true, archivedAt: null },
      select: { id: true, name: true, ownerUserId: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    expiring: links.map((l) => ({
      controlInstanceId: l.controlInstance.id,
      controlKey: l.controlInstance.definition.key,
      controlOwnerId: l.controlInstance.ownerUserId,
      systemId: l.controlInstance.system.id,
      systemName: l.controlInstance.system.name,
      systemOwnerId: l.controlInstance.system.ownerUserId,
      evidenceSummary: l.evidence.summary,
      validUntil: l.evidence.validUntil!,
    })),
    integrations,
    staleClassifications: stale.map((s) => ({
      systemId: s.id,
      systemName: s.name,
      systemOwnerId: s.ownerUserId,
    })),
  };
}

const setOrg = (tx: OrgTransaction, orgId: string) =>
  tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, TRUE)`;

/**
 * Job `notification.digest` : résumé quotidien d'un utilisateur, ses organisations réunies en un seul email (au plus un
 * par jour). La transaction du job passe d'une organisation à l'autre (app.org_id local à la transaction).
 */
export async function sendDailyDigest(
  tx: OrgTransaction,
  input: { userId: string; day: string },
  deps: NotificationDependencies = defaultNotificationDependencies(),
): Promise<"sent" | "empty" | "skipped"> {
  const user = await userContact(input.userId);
  if (!user) return "skipped";
  const now = deps.now();
  const memberships = await membershipsOfUser(input.userId);
  const included: { orgId: string; name: string; digest: OrgDigest }[] = [];
  for (const m of memberships) {
    await setOrg(tx, m.id);
    const already = await tx.notification.findFirst({
      where: {
        userId: input.userId,
        type: "digest.daily",
        payload: { path: ["day"], equals: input.day },
      },
      select: { id: true },
    });
    if (already) return "skipped";
    if (!(await preferencesOf(tx, m.id, input.userId)).dailyDigestEmail) continue;
    const digest = digestForUser(await digestFacts(tx, now), input.userId, m.role);
    if (digest) included.push({ orgId: m.id, name: m.name, digest });
  }
  if (included.length === 0) return "empty";
  await deps.transport.send(
    await renderDigestEmail({
      to: user.email,
      name: user.name,
      locale: user.locale,
      baseUrl: deps.baseUrl,
      organizations: included.map(({ name, digest }) => ({ name, digest })),
    }),
  );
  for (const { orgId, digest } of included) {
    await setOrg(tx, orgId);
    await tx.notification.create({
      data: {
        orgId,
        userId: input.userId,
        type: "digest.daily",
        payload: {
          day: input.day,
          expiring: digest.expiring.length,
          integrations: digest.integrations.length,
          staleClassifications: digest.staleClassifications.length,
        },
        emailedAt: now,
      },
    });
  }
  return "sent";
}

// ───────────── Routeur `notification` (§4.4.2), tout membre ─────────────

export async function getPreferences(ctx: OrgContext) {
  return withOrgTransaction(ctx.orgId, (tx) => preferencesOf(tx, ctx.orgId, ctx.userId));
}

export async function setPreferences(
  ctx: OrgContext,
  input: { controlFailedEmail: boolean; dailyDigestEmail: boolean },
) {
  const saved = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.notificationPreference.upsert({
      where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
      create: { orgId: ctx.orgId, userId: ctx.userId, ...input },
      update: input,
    }),
  );
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "notification.preferences",
    { type: "user", id: ctx.userId },
    input,
  );
  return { controlFailedEmail: saved.controlFailedEmail, dailyDigestEmail: saved.dailyDigestEmail };
}

/** Les 50 dernières alertes de l'utilisateur dans l'organisation active. */
export async function listNotifications(ctx: OrgContext) {
  const rows = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.notification.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  );
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    payload: n.payload as Record<string, unknown>,
    read: n.readAt !== null,
    emailed: n.emailedAt !== null,
    createdAt: n.createdAt.toISOString(),
  }));
}

/** Marque comme lues des alertes de l'utilisateur (les autres identifiants sont ignorés). */
export async function markRead(ctx: OrgContext, input: { ids: string[] }) {
  if (input.ids.length === 0) throw new ServiceError("BAD_REQUEST", "notification.empty");
  const { count } = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.notification.updateMany({
      where: { id: { in: input.ids }, userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    }),
  );
  return { count };
}
