// PL-607 — Export complet d'une organisation (« En tant qu'owner, je veux partir avec mes données ») : registre,
// classifications, contrôles, preuves (charge, charge brute et pièce jointe déchiffrées), packs d'audit, journal.
// `requestExport` (owner) programme le job `org.export` ; `buildExport` rassemble tout dans la transaction du job,
// écrit `orgs/{orgId}/exports/{id}.zip`, prévient le demandeur (notification `export.ready` et email). Jamais de jeton
// d'intégration ni de clé dans l'archive. Ouvert en lecture seule (réversibilité, §3.2 E11).
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import { decrypt, masterKeyFromEnv, type MasterKey } from "@/server/crypto/envelope";
import { zipExport } from "@/server/export/contents";
import { EXTENSIONS } from "@/server/pack/contents";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import { membersOf } from "@/server/system/identity";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import { orgDataKey } from "./evidence";
import type { OrgContext } from "./organization";

export const exportObjectKey = (orgId: string, exportId: string) =>
  `orgs/${orgId}/exports/${exportId}.zip`;

export interface ExportDependencies {
  store: ObjectStore;
  master: () => MasterKey;
  now: () => Date;
}

/** Dépendances remplaçables par les tests. */
export const exportStorage: { get: () => ExportDependencies } = {
  get: () => ({
    store: createObjectStore(),
    master: () => masterKeyFromEnv(),
    now: () => new Date(),
  }),
};

export type ScheduleExportBuild = (
  tx: OrgTransaction,
  orgId: string,
  exportId: string,
) => Promise<unknown>;

export type ScheduleExportEmail = (
  tx: OrgTransaction,
  orgId: string,
  notificationId: string,
) => Promise<unknown>;

function record(
  ctx: OrgContext,
  action: "org.export" | "org.exportDownload",
  exportId: string,
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
    { type: "org_export", id: exportId },
    metadata,
  );
}

const exportView = (e: {
  id: string;
  status: string;
  sizeBytes: number | null;
  counts: unknown;
  createdAt: Date;
  completedAt: Date | null;
}) => ({
  id: e.id,
  status: e.status,
  sizeBytes: e.sizeBytes,
  counts: (e.counts ?? null) as Record<string, number> | null,
  createdAt: e.createdAt.toISOString(),
  completedAt: e.completedAt?.toISOString() ?? null,
});

export async function requestExport(ctx: OrgContext, schedule: ScheduleExportBuild) {
  const created = await withOrgTransaction(ctx.orgId, async (tx) => {
    const running = await tx.orgExport.count({
      where: { orgId: ctx.orgId, status: { in: ["QUEUED", "BUILDING"] } },
    });
    if (running > 0) throw new ServiceError("CONFLICT", "export.inProgress");
    const row = await tx.orgExport.create({
      data: { orgId: ctx.orgId, requestedByUserId: ctx.userId },
    });
    await schedule(tx, ctx.orgId, row.id);
    return row;
  });
  await record(ctx, "org.export", created.id);
  return exportView(created);
}

export async function listExports(ctx: OrgContext) {
  const rows = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.orgExport.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  );
  return rows.map(exportView);
}

export async function downloadExport(
  ctx: OrgContext,
  input: { exportId: string },
  store: ObjectStore = exportStorage.get().store,
) {
  const row = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.orgExport.findFirst({ where: { id: input.exportId, orgId: ctx.orgId } }),
  );
  if (!row) throw new ServiceError("NOT_FOUND", "export.notFound");
  if (row.status !== "READY" || !row.objectKey)
    throw new ServiceError("CONFLICT", "export.notReady");
  const bytes = await store.get(row.objectKey);
  if (!bytes) throw new ServiceError("NOT_FOUND", "export.notFound");
  await record(ctx, "org.exportDownload", row.id, { size: bytes.length });
  return { bytes, filename: `prooflayer-export-${row.createdAt.toISOString().slice(0, 10)}.zip` };
}

/** Job `org.export` : rassemble, archive, écrit, prévient. Rejoué sans effet si l'export est déjà prêt. */
export async function buildExport(
  tx: OrgTransaction,
  orgId: string,
  exportId: string,
  deps: ExportDependencies,
  notify: ScheduleExportEmail,
) {
  const row = await tx.orgExport.findFirst({ where: { id: exportId, orgId } });
  if (!row || row.status === "READY") return;
  const organization = await tx.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) return;

  const where = { orgId };
  const [
    systems,
    designChanges,
    classifications,
    exemptions,
    controls,
    evaluations,
    comments,
    evidenceLinks,
    integrations,
    sealBatches,
    auditLog,
    packRows,
    evidenceRows,
  ] = await Promise.all([
    tx.aiSystem.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.designChange.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.classification.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.exemptionDossier.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.controlInstance.findMany({
      where,
      include: { definition: { select: { key: true, libraryVersion: true, title: true } } },
      orderBy: { id: "asc" },
    }),
    tx.controlEvaluation.findMany({ where, orderBy: { evaluatedAt: "asc" } }),
    tx.controlComment.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.evidenceLink.findMany({ where }),
    tx.integration.findMany({
      where,
      // Jamais de jeton : les identifiants chiffrés restent hors de l'archive.
      select: {
        id: true,
        provider: true,
        externalAccountId: true,
        externalAccountName: true,
        status: true,
        scopes: true,
        createdAt: true,
        resources: { select: { id: true, kind: true, externalId: true, name: true, config: true } },
      },
    }),
    tx.sealBatch.findMany({ where, orderBy: { seq: "asc" } }),
    tx.auditLog.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.auditPack.findMany({ where, orderBy: { createdAt: "asc" } }),
    tx.evidenceItem.findMany({ where, orderBy: [{ capturedAt: "asc" }, { id: "asc" }] }),
  ]);

  const needsKey = evidenceRows.some((e) => !e.redactedAt && (e.rawObjectKey || e.attachmentKey));
  const dek = needsKey ? await orgDataKey(tx, orgId, deps.master()) : null;
  const evidence = [];
  for (const e of evidenceRows) {
    let raw: Uint8Array | null = null;
    let attachment: { bytes: Uint8Array; extension: string } | null = null;
    if (dek && !e.redactedAt && e.rawObjectKey) {
      const sealed = await deps.store.get(e.rawObjectKey);
      if (sealed) raw = decrypt(dek, sealed, `raw:${orgId}:${e.id}`);
    }
    if (dek && !e.redactedAt && e.attachmentKey) {
      const sealed = await deps.store.get(e.attachmentKey);
      if (sealed) {
        attachment = {
          bytes: decrypt(dek, sealed, `attachment:${orgId}:${e.id}`),
          extension: (e.attachmentMime && EXTENSIONS[e.attachmentMime]) || "bin",
        };
      }
    }
    const { rawObjectKey: _raw, attachmentKey: _att, ...rest } = e;
    void _raw;
    void _att;
    evidence.push({ row: rest, raw, attachment });
  }

  const packs = [];
  for (const p of packRows) {
    const { objectKey, ...meta } = p;
    packs.push({
      meta,
      zip: p.status === "READY" && objectKey ? await deps.store.get(objectKey) : null,
    });
  }

  const members = (await membersOf(orgId)).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
  }));

  const now = deps.now();
  const { zip, counts } = zipExport({
    organization,
    exportedAt: now,
    members,
    systems,
    designChanges,
    classifications,
    exemptions,
    controls,
    evaluations,
    comments,
    evidenceLinks,
    integrations,
    sealBatches,
    auditLog,
    packs,
    evidence,
  });
  const objectKey = exportObjectKey(orgId, exportId);
  await deps.store.put(objectKey, zip);
  await tx.orgExport.update({
    where: { id: exportId },
    data: { status: "READY", objectKey, sizeBytes: zip.length, counts, completedAt: now },
  });
  const notification = await tx.notification.create({
    data: {
      orgId,
      userId: row.requestedByUserId,
      type: "export.ready",
      payload: { exportId, sizeBytes: zip.length, ...counts },
    },
  });
  await notify(tx, orgId, notification.id);
}

/** Dernière tentative épuisée : l'export passe FAILED (le propriétaire peut en relancer un). */
export async function failExport(tx: OrgTransaction, orgId: string, exportId: string) {
  await tx.orgExport.updateMany({
    where: { id: exportId, orgId, status: { not: "READY" } },
    data: { status: "FAILED", completedAt: new Date() },
  });
}
