// Détail d'un contrôle (PL-407, écran D du §5.3, routeur `control` du §4.4.2) : énoncé, dernière évaluation et ses
// raisons, frise de 12 semaines, preuves liées (fautives en tête), preuve attendue ; assignation d'un responsable
// (contributor), non-applicabilité justifiée (admin), commentaires (contributor). La partie scellement arrive au
// sprint 5 (PL-503).
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import type { ControlStatus } from "@/generated/prisma/enums";
import { NA_BY_RECLASSIFICATION } from "@/server/rules/instantiate";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { membersOf, usersByIds } from "@/server/system/identity";
import { audit, clientIp } from "./audit";
import {
  EVIDENCE_PAGE_SIZE,
  expectedEvidence,
  faultyEvidenceIds,
  HISTORY_WEEKS,
  orderEvidence,
  parseReasons,
  safeSourceUrl,
  weeklyHistory,
  weekStart,
} from "./control-detail-data";
import { articleOf } from "./dashboard-data";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

const DAY_MS = 86_400_000;

async function loadInstance(tx: OrgTransaction, orgId: string, controlId: string) {
  const instance = await tx.controlInstance.findFirst({
    where: { id: controlId, orgId },
    include: {
      definition: true,
      system: { select: { id: true, name: true, archivedAt: true } },
    },
  });
  if (!instance) throw new ServiceError("NOT_FOUND", "control.notFound");
  return instance;
}

function record(
  ctx: OrgContext,
  action: "control.assign" | "control.setNotApplicable" | "control.comment",
  controlId: string,
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
    { type: "control_instance", id: controlId },
    metadata,
  );
}

/** `control.get` : tout ce qu'affiche l'écran D. Lecture : tout membre. */
export async function getControl(
  ctx: OrgContext,
  input: { controlId: string; page?: number },
  now = new Date(),
) {
  const page = Math.max(1, input.page ?? 1);
  const data = await withOrgTransaction(ctx.orgId, async (tx) => {
    const instance = await loadInstance(tx, ctx.orgId, input.controlId);
    const since = new Date(weekStart(now).getTime() - (HISTORY_WEEKS - 1) * 7 * DAY_MS);
    const [latest, history, links, comments] = await Promise.all([
      tx.controlEvaluation.findFirst({
        where: { controlInstanceId: instance.id },
        orderBy: { evaluatedAt: "desc" },
      }),
      tx.controlEvaluation.findMany({
        where: { controlInstanceId: instance.id, evaluatedAt: { gte: since } },
        select: { status: true, evaluatedAt: true },
      }),
      tx.evidenceLink.findMany({
        where: { controlInstanceId: instance.id },
        select: { evidenceId: true, linkedBy: true },
      }),
      tx.controlComment.findMany({
        where: { controlInstanceId: instance.id },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    ]);
    const reasons = latest ? parseReasons(latest.reasons) : [];
    const faulty = faultyEvidenceIds(latest ? { status: latest.status, reasons } : null);
    // Preuves liées au contrôle, et preuves citées par la dernière évaluation (même non liées : une preuve fautive).
    const ids = [...new Set([...links.map((l) => l.evidenceId), ...faulty])];
    const items = ids.length
      ? await tx.evidenceItem.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            kind: true,
            source: true,
            summary: true,
            sourceUrl: true,
            occurredAt: true,
            capturedAt: true,
            declarative: true,
            validUntil: true,
            redactedAt: true,
            leafHash: true,
            sealBatch: {
              select: {
                seq: true,
                sealedAt: true,
                anchor: { select: { seq: true, tsaGenTime: true, tsaName: true } },
              },
            },
          },
        })
      : [];
    return { instance, latest, reasons, history, links, comments, items, faulty };
  });

  const { instance, latest, reasons, items, faulty } = data;
  const linkedBy = new Map(data.links.map((l) => [l.evidenceId, l.linkedBy]));
  const ordered = orderEvidence(items, faulty);
  const pages = Math.max(1, Math.ceil(ordered.length / EVIDENCE_PAGE_SIZE));
  const current = Math.min(page, pages);
  const users = await usersByIds([
    ...(instance.ownerUserId ? [instance.ownerUserId] : []),
    ...data.comments.map((c) => c.authorUserId),
  ]);
  const members = await membersOf(ctx.orgId);
  const definition = instance.definition;
  const naByReclassification = instance.naJustification === NA_BY_RECLASSIFICATION;

  return {
    id: instance.id,
    system: {
      id: instance.system.id,
      name: instance.system.name,
      archived: instance.system.archivedAt !== null,
    },
    key: definition.key,
    article: articleOf(definition.articleRef),
    articleRef: definition.articleRef,
    title: definition.title as { fr: string; en: string },
    statement: definition.statement as { fr: string; en: string },
    automation: definition.automation,
    status: (instance.notApplicable ? "NOT_APPLICABLE" : instance.status) as ControlStatus,
    owner: instance.ownerUserId
      ? {
          id: instance.ownerUserId,
          name: users.get(instance.ownerUserId)?.name ?? null,
        }
      : null,
    notApplicable: instance.notApplicable,
    /** Écarté par une reclassification : la justification est celle de la classification, pas d'un administrateur. */
    naByReclassification,
    naJustification: naByReclassification ? null : instance.naJustification,
    lastEvaluation: latest
      ? {
          status: latest.status,
          evaluatedAt: latest.evaluatedAt.toISOString(),
          evaluatorVersion: latest.evaluatorVersion,
          reasons,
        }
      : null,
    history: weeklyHistory(data.history, now),
    expected: expectedEvidence({
      evidenceKinds: definition.evidenceKinds,
      evaluatorKey: definition.evaluatorKey,
      freshnessDays: definition.freshnessDays,
      params: definition.params,
    }),
    evidence: {
      total: ordered.length,
      faulty: ordered.filter((e) => e.faulty).length,
      page: current,
      pages,
      items: ordered
        .slice((current - 1) * EVIDENCE_PAGE_SIZE, current * EVIDENCE_PAGE_SIZE)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          source: e.source,
          summary: e.summary,
          sourceUrl: safeSourceUrl(e.sourceUrl),
          occurredAt: e.occurredAt.toISOString(),
          capturedAt: e.capturedAt.toISOString(),
          declarative: e.declarative,
          validUntil: e.validUntil?.toISOString() ?? null,
          redacted: e.redactedAt !== null,
          faulty: e.faulty,
          linkedByUser: (linkedBy.get(e.id) ?? "rule") !== "rule",
          // Scellement (PL-503, §5.3 écran D) : empreinte, lot, ancre, date du jeton.
          seal: {
            leafHash: Buffer.from(e.leafHash).toString("hex"),
            batch: e.sealBatch
              ? { seq: e.sealBatch.seq, sealedAt: e.sealBatch.sealedAt.toISOString() }
              : null,
            anchor: e.sealBatch?.anchor
              ? {
                  seq: e.sealBatch.anchor.seq,
                  timestampedAt: e.sealBatch.anchor.tsaGenTime.toISOString(),
                  tsaName: e.sealBatch.anchor.tsaName,
                }
              : null,
          },
        })),
    },
    comments: data.comments.map((c) => ({
      id: c.id,
      author: { id: c.authorUserId, name: users.get(c.authorUserId)?.name ?? null },
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    members: members.map((m) => ({ id: m.userId, name: m.user.name })),
  };
}

/** `control.evaluations` : historique des évaluations, la plus récente d'abord. Lecture : tout membre. */
export async function listEvaluations(
  ctx: OrgContext,
  input: { controlId: string; limit?: number },
) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const instance = await loadInstance(tx, ctx.orgId, input.controlId);
    const rows = await tx.controlEvaluation.findMany({
      where: { controlInstanceId: instance.id },
      orderBy: { evaluatedAt: "desc" },
      take: Math.min(Math.max(input.limit ?? 50, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      evaluatedAt: r.evaluatedAt.toISOString(),
      evaluatorVersion: r.evaluatorVersion,
      reasons: parseReasons(r.reasons),
      evidenceIds: r.evidenceIds,
    }));
  });
}

function assertWritable(instance: { system: { archivedAt: Date | null } }) {
  if (instance.system.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
}

/** `control.assignOwner` (contributor) : un membre de l'organisation, ou personne. */
export async function assignOwner(
  ctx: OrgContext,
  input: { controlId: string; ownerUserId: string | null },
) {
  if (input.ownerUserId) {
    const members = await membersOf(ctx.orgId);
    if (!members.some((m) => m.userId === input.ownerUserId)) {
      throw new ServiceError("BAD_REQUEST", "control.ownerNotMember");
    }
  }
  const before = await withOrgTransaction(ctx.orgId, async (tx) => {
    const instance = await loadInstance(tx, ctx.orgId, input.controlId);
    assertWritable(instance);
    await tx.controlInstance.update({
      where: { id: instance.id },
      data: { ownerUserId: input.ownerUserId },
    });
    return instance.ownerUserId;
  });
  if (before !== input.ownerUserId) {
    await record(ctx, "control.assign", input.controlId, {
      before,
      after: input.ownerUserId,
    });
  }
  return { ownerUserId: input.ownerUserId };
}

/**
 * `control.setNotApplicable` (admin) : déclarer non applicable avec une justification, ou rouvrir. Un contrôle écarté
 * par une reclassification suit la classification : il ne se rouvre pas à la main. Un contrôle rouvert repart
 * « sans preuve » et son évaluation est programmée.
 */
export async function setNotApplicable(
  ctx: OrgContext,
  input: { controlId: string; notApplicable: boolean; justification?: string | null },
) {
  const justification = input.justification?.trim() ?? "";
  if (input.notApplicable && justification.length === 0) {
    throw new ServiceError("BAD_REQUEST", "control.justificationRequired");
  }
  if (justification === NA_BY_RECLASSIFICATION) {
    throw new ServiceError("BAD_REQUEST", "control.justificationRequired");
  }
  await withOrgTransaction(ctx.orgId, async (tx) => {
    const instance = await loadInstance(tx, ctx.orgId, input.controlId);
    assertWritable(instance);
    if (instance.naJustification === NA_BY_RECLASSIFICATION) {
      throw new ServiceError("CONFLICT", "control.naByReclassification");
    }
    if (input.notApplicable) {
      await tx.controlInstance.update({
        where: { id: instance.id },
        data: { notApplicable: true, naJustification: justification, status: "NOT_APPLICABLE" },
      });
    } else {
      if (!instance.notApplicable) return;
      await tx.controlInstance.update({
        where: { id: instance.id },
        data: { notApplicable: false, naJustification: null, status: "MISSING" },
      });
      await scheduleEvaluation(tx, ctx.orgId, instance.id);
    }
  });
  await record(ctx, "control.setNotApplicable", input.controlId, {
    notApplicable: input.notApplicable,
    ...(input.notApplicable ? { justification } : {}),
  });
  return { notApplicable: input.notApplicable };
}

/** `control.comment` (contributor) : un commentaire, en ajout seul. Le texte n'entre pas au journal. */
export async function addComment(ctx: OrgContext, input: { controlId: string; body: string }) {
  const body = input.body.trim();
  if (body.length === 0) throw new ServiceError("BAD_REQUEST", "control.commentEmpty");
  const comment = await withOrgTransaction(ctx.orgId, async (tx) => {
    const instance = await loadInstance(tx, ctx.orgId, input.controlId);
    assertWritable(instance);
    return tx.controlComment.create({
      data: {
        orgId: ctx.orgId,
        controlInstanceId: instance.id,
        authorUserId: ctx.userId,
        body,
      },
    });
  });
  await record(ctx, "control.comment", input.controlId, {
    commentId: comment.id,
    length: body.length,
  });
  return { id: comment.id };
}
