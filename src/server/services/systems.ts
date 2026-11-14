// Registre des systèmes d'IA (PL-201, §3.2 E2, §5.3 écran B). Toute modification de fiche est historisée dans le
// journal d'audit (qui, quand, avant, après) ; modifier un champ utilisé par la classification la marque « à revoir ».
// Les modifications de conception (DesignChange) fondent l'analyse de l'Art. 111(2) : elles se qualifient
// « significatives ou non » avec un motif.
import { withOrgTransaction, type forOrg } from "@/server/db";
import { findMembership, usersByIds } from "@/server/system/identity";
import { audit, clientIp, type AuditAction } from "./audit";
import { ServiceError } from "./errors";
import { assertCanMonitor } from "./entitlements";
import { scheduleOrgSweep } from "./evaluation";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { recordRegistrySnapshot } from "./system-evidence";
import type { OrgContext } from "./organization";
import {
  CLASSIFICATION_FIELDS,
  diffSystem,
  nextFreeSlug,
  normalizeCategories,
  parseModels,
  registryToCsv,
  registryToJson,
  slugify,
  touchesClassification,
  type FieldChange,
  type RegistryRow,
  type SystemFields,
  type SystemPatch,
} from "./system-registry";

/** Cible des entrées du journal d'audit qui portent l'historique d'une fiche. */
export const SYSTEM_TARGET = "ai_system";
export const DESIGN_CHANGE_TARGET = "design_change";

function dbOf(ctx: OrgContext): ReturnType<typeof forOrg> {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
}

function record(
  ctx: OrgContext,
  action: AuditAction,
  target: { type: string; id: string },
  metadata: Record<string, unknown>,
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

/** Un responsable de système est un membre de l'organisation. */
async function assertMember(ctx: OrgContext, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await findMembership(ctx.orgId, userId))) {
    throw new ServiceError("BAD_REQUEST", "system.ownerNotMember");
  }
}

async function findSystem(ctx: OrgContext, id: string) {
  const system = await dbOf(ctx).aiSystem.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  return system;
}

type SystemRow = Awaited<ReturnType<typeof findSystem>>;

function fieldsOf(s: SystemRow): SystemFields {
  return {
    name: s.name,
    intendedPurpose: s.intendedPurpose,
    description: s.description,
    role: s.role,
    status: s.status,
    placedOnMarketAt: s.placedOnMarketAt,
    ownerUserId: s.ownerUserId,
    oversightOwnerUserId: s.oversightOwnerUserId,
    vendorName: s.vendorName,
    models: parseModels(s.models),
    dataCategories: s.dataCategories,
  };
}

const personOf = (users: Awaited<ReturnType<typeof usersByIds>>, id: string | null) => {
  const user = id ? users.get(id) : undefined;
  return user && id ? { id, name: user.name, email: user.email } : null;
};

export async function listSystems(ctx: OrgContext, input: { includeArchived?: boolean } = {}) {
  const rows = await dbOf(ctx).aiSystem.findMany({
    where: { orgId: ctx.orgId, ...(input.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const users = await usersByIds(rows.map((r) => r.ownerUserId));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    intendedPurpose: r.intendedPurpose,
    role: r.role,
    status: r.status,
    riskTier: r.riskTier,
    annexIIIPoints: r.annexIIIPoints,
    classificationStale: r.classificationStale,
    monitored: r.monitored,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    owner: personOf(users, r.ownerUserId),
  }));
}

/** Dernière modification d'un champ de classification : motif de l'encart « Classification à revoir ». */
async function staleCause(ctx: OrgContext, systemId: string) {
  const entries = await dbOf(ctx).auditLog.findMany({
    where: { targetType: SYSTEM_TARGET, targetId: systemId, action: "system.update" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  for (const entry of entries) {
    const changes = (entry.metadata as { changes?: FieldChange[] }).changes ?? [];
    const field = changes.find((c) =>
      (CLASSIFICATION_FIELDS as readonly string[]).includes(c.field),
    )?.field;
    if (field) return { field, at: entry.createdAt.toISOString() };
  }
  return null;
}

export async function getSystem(ctx: OrgContext, input: { id: string }) {
  const s = await findSystem(ctx, input.id);
  const users = await usersByIds([
    s.ownerUserId,
    ...(s.oversightOwnerUserId ? [s.oversightOwnerUserId] : []),
  ]);
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    intendedPurpose: s.intendedPurpose,
    description: s.description,
    role: s.role,
    status: s.status,
    riskTier: s.riskTier,
    annexIIIPoints: s.annexIIIPoints,
    placedOnMarketAt: s.placedOnMarketAt?.toISOString() ?? null,
    owner: personOf(users, s.ownerUserId),
    oversightOwner: personOf(users, s.oversightOwnerUserId),
    vendorName: s.vendorName,
    models: parseModels(s.models),
    dataCategories: s.dataCategories,
    monitored: s.monitored,
    classificationStale: s.classificationStale,
    staleCause: s.classificationStale ? await staleCause(ctx, s.id) : null,
    /** Contrôles ouverts et applicables (onglet « Contrôles » de l'écran B). */
    controlCount: await dbOf(ctx).controlInstance.count({
      where: { systemId: s.id, notApplicable: false },
    }),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    archivedAt: s.archivedAt?.toISOString() ?? null,
  };
}

/** Création en 3 champs obligatoires : nom, finalité prévue, responsable (§3.2 E2). */
export async function createSystem(
  ctx: OrgContext,
  input: { name: string; intendedPurpose: string; ownerUserId: string },
) {
  await assertMember(ctx, input.ownerUserId);
  const db = dbOf(ctx);
  const base = slugify(input.name);
  const taken = await db.aiSystem.findMany({
    where: { orgId: ctx.orgId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const system = await db.aiSystem.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      slug: nextFreeSlug(base, new Set(taken.map((t) => t.slug))),
      intendedPurpose: input.intendedPurpose,
      ownerUserId: input.ownerUserId,
      models: [],
      dataCategories: [],
    },
  });
  await record(
    ctx,
    "system.create",
    { type: SYSTEM_TARGET, id: system.id },
    {
      name: system.name,
      intendedPurpose: system.intendedPurpose,
      ownerUserId: system.ownerUserId,
    },
  );
  await snapshotRegistry(ctx, system.id);
  return { id: system.id, slug: system.slug };
}

/** Instantané de la fiche au magasin de preuves (PL-402), après chaque écriture : responsables, « à revoir ». */
const snapshotRegistry = (ctx: OrgContext, systemId: string) =>
  withOrgTransaction(ctx.orgId, (tx) => recordRegistrySnapshot(tx, ctx.orgId, systemId));

/**
 * Modification de fiche. Chaque champ modifié est inscrit au journal avec sa valeur avant et après.
 * Si un champ utilisé par la classification change alors qu'une classification signée est en vigueur, elle passe
 * « à revoir » ; un brouillon seul n'a rien à revoir.
 * Écriture conditionnée à `updatedAt` : deux modifications simultanées ne s'écrasent pas sans être historisées.
 */
export async function updateSystem(ctx: OrgContext, input: { id: string; patch: SystemPatch }) {
  const current = await findSystem(ctx, input.id);
  if (current.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  const patch: SystemPatch = {
    ...input.patch,
    ...(input.patch.dataCategories
      ? { dataCategories: normalizeCategories(input.patch.dataCategories) }
      : {}),
  };
  await assertMember(ctx, patch.ownerUserId);
  await assertMember(ctx, patch.oversightOwnerUserId);

  const changes = diffSystem(fieldsOf(current), patch);
  if (changes.length === 0) return { changed: 0, classificationStale: current.classificationStale };

  const db = dbOf(ctx);
  const markStale =
    touchesClassification(changes) &&
    !current.classificationStale &&
    (await db.classification.count({
      where: { systemId: current.id, status: "SIGNED" },
    })) > 0;

  const data: Record<string, unknown> = {};
  for (const { field } of changes) data[field] = patch[field];
  if (markStale) data.classificationStale = true;

  const { count } = await db.aiSystem.updateMany({
    where: { id: current.id, orgId: ctx.orgId, updatedAt: current.updatedAt },
    data,
  });
  if (count === 0) throw new ServiceError("CONFLICT", "system.conflict");

  await record(
    ctx,
    "system.update",
    { type: SYSTEM_TARGET, id: current.id },
    {
      changes,
      ...(markStale ? { classificationStale: true } : {}),
    },
  );
  await snapshotRegistry(ctx, current.id);
  return { changed: changes.length, classificationStale: current.classificationStale || markStale };
}

/** Archivage : la fiche reste au registre (lecture, export) ; elle sort de la surveillance. */
export async function archiveSystem(ctx: OrgContext, input: { id: string }) {
  const current = await findSystem(ctx, input.id);
  if (current.archivedAt) return;
  await dbOf(ctx).aiSystem.update({
    where: { id: current.id },
    data: { archivedAt: new Date(), monitored: false },
  });
  await record(
    ctx,
    "system.archive",
    { type: SYSTEM_TARGET, id: current.id },
    {
      monitored: current.monitored,
    },
  );
  await snapshotRegistry(ctx, current.id);
}

/**
 * Surveillance d'un système (PL-602) : seuls les systèmes surveillés sont évalués et comptent dans la limite du plan.
 * Au-delà de la limite, la mise sous surveillance est refusée avec proposition de plan ; l'arrêt libère une place.
 */
export async function setSystemMonitored(
  ctx: OrgContext,
  input: { id: string; monitored: boolean },
) {
  const current = await findSystem(ctx, input.id);
  if (current.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  if (current.monitored === input.monitored) return { monitored: current.monitored };
  await withOrgTransaction(ctx.orgId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('monitor:' || ${ctx.orgId}, 0))`;
    if (input.monitored) await assertCanMonitor(tx, ctx.orgId);
    await tx.aiSystem.update({ where: { id: current.id }, data: { monitored: input.monitored } });
    // Remis sous surveillance : ses contrôles sont jugés sur les preuves déjà présentes.
    if (input.monitored) await scheduleOrgSweep(tx, ctx.orgId, scheduleEvaluation, current.id);
  });
  await record(
    ctx,
    "system.monitor",
    { type: SYSTEM_TARGET, id: current.id },
    { changes: [{ field: "monitored", before: current.monitored, after: input.monitored }] },
  );
  return { monitored: input.monitored };
}

/** Historique de la fiche : création, modifications champ par champ, archivage. Du plus récent au plus ancien. */
export async function systemHistory(ctx: OrgContext, input: { id: string }) {
  const system = await findSystem(ctx, input.id);
  const entries = await dbOf(ctx).auditLog.findMany({
    where: { targetType: SYSTEM_TARGET, targetId: system.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const changesOf = (metadata: unknown) => (metadata as { changes?: FieldChange[] }).changes ?? [];
  // Responsables cités dans les modifications : présentés par leur nom plutôt que par leur identifiant.
  const people = entries.flatMap((e) =>
    changesOf(e.metadata)
      .filter((c) => c.field === "ownerUserId" || c.field === "oversightOwnerUserId")
      .flatMap((c) => [c.before, c.after].filter((v): v is string => typeof v === "string")),
  );
  const users = await usersByIds([
    ...entries.flatMap((e) => (e.actorId ? [e.actorId] : [])),
    ...people,
  ]);
  return {
    people: Object.fromEntries(people.map((id) => [id, personOf(users, id)?.name ?? id])),
    entries: entries.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      action: e.action,
      actor: personOf(users, e.actorId),
      changes: changesOf(e.metadata),
    })),
  };
}

export async function listDesignChanges(ctx: OrgContext, input: { systemId: string }) {
  await findSystem(ctx, input.systemId);
  const rows = await dbOf(ctx).designChange.findMany({
    where: { systemId: input.systemId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  const users = await usersByIds(rows.flatMap((r) => (r.qualifiedBy ? [r.qualifiedBy] : [])));
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    summary: r.summary,
    isSignificant: r.isSignificant,
    qualificationReason: r.qualificationReason,
    qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
    qualifiedBy: personOf(users, r.qualifiedBy),
    evidenceId: r.evidenceId,
  }));
}

/** Saisie manuelle d'une modification de conception ; les releases GitHub en créeront aussi (sprint 3). */
export async function recordDesignChange(
  ctx: OrgContext,
  input: { systemId: string; occurredAt: Date; summary: string },
) {
  const system = await findSystem(ctx, input.systemId);
  if (system.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  const change = await dbOf(ctx).designChange.create({
    data: {
      orgId: ctx.orgId,
      systemId: system.id,
      occurredAt: input.occurredAt,
      summary: input.summary,
    },
  });
  await record(
    ctx,
    "designChange.create",
    { type: DESIGN_CHANGE_TARGET, id: change.id },
    {
      systemId: system.id,
      occurredAt: input.occurredAt.toISOString(),
      summary: input.summary,
    },
  );
  return { id: change.id };
}

/**
 * Qualification « significative ou non » au sens de l'Art. 111(2) et de l'Art. 3(23), avec motif obligatoire.
 * Une requalification reste possible : l'ancienne appréciation figure au journal (avant, après).
 */
export async function qualifyDesignChange(
  ctx: OrgContext,
  input: { id: string; isSignificant: boolean; reason: string },
) {
  const db = dbOf(ctx);
  const change = await db.designChange.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
  if (!change) throw new ServiceError("NOT_FOUND", "designChange.notFound");
  await db.designChange.update({
    where: { id: change.id },
    data: {
      isSignificant: input.isSignificant,
      qualificationReason: input.reason,
      qualifiedBy: ctx.userId,
      qualifiedAt: new Date(),
    },
  });
  await record(
    ctx,
    "designChange.qualify",
    { type: DESIGN_CHANGE_TARGET, id: change.id },
    {
      systemId: change.systemId,
      before: { isSignificant: change.isSignificant, reason: change.qualificationReason },
      after: { isSignificant: input.isSignificant, reason: input.reason },
    },
  );
}

/** Export du registre complet, fiches archivées comprises (§3.2 E2). */
export async function exportRegistry(ctx: OrgContext, input: { format: "csv" | "json" }) {
  const rows = await dbOf(ctx).aiSystem.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const users = await usersByIds(
    rows.flatMap((r) => [
      r.ownerUserId,
      ...(r.oversightOwnerUserId ? [r.oversightOwnerUserId] : []),
    ]),
  );
  const label = (id: string | null) => {
    const p = personOf(users, id);
    return p ? `${p.name} <${p.email}>` : id;
  };
  const registry: RegistryRow[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    intendedPurpose: r.intendedPurpose,
    description: r.description,
    role: r.role,
    status: r.status,
    riskTier: r.riskTier,
    annexIIIPoints: r.annexIIIPoints,
    classificationStale: r.classificationStale,
    placedOnMarketAt: r.placedOnMarketAt,
    owner: label(r.ownerUserId) ?? r.ownerUserId,
    oversightOwner: label(r.oversightOwnerUserId),
    vendorName: r.vendorName,
    models: parseModels(r.models),
    dataCategories: r.dataCategories,
    monitored: r.monitored,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
  }));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  return input.format === "csv"
    ? {
        filename: `registre-systemes-ia-${day}.csv`,
        mimeType: "text/csv",
        content: registryToCsv(registry),
      }
    : {
        filename: `registre-systemes-ia-${day}.json`,
        mimeType: "application/json",
        content: registryToJson(registry, now),
      };
}
