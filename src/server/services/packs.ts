// Packs d'audit (PL-504, §3.2 E9, écran E du §5.3, routeur `pack` du §4.4.2). `createPack` (admin) programme le job
// `pack.build` ; `buildPack` scelle les preuves en attente, demande un ancrage immédiat (§4.6.2 étape 3), rassemble
// contrôles, preuves divulguées, lots et ancres de la période, rend le rapport, signe le manifeste en Ed25519, écrit
// l'archive en stockage objet et prévient le demandeur. Aucune option n'exclut un contrôle en échec ou sans preuve.
import { createHash } from "node:crypto";
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import { decrypt, masterKeyFromEnv, type MasterKey } from "@/server/crypto/envelope";
import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/i18n/config";
import {
  buildPackFiles,
  type PackAnchor,
  type PackBatch,
  type PackControl,
  type PackEvidence,
} from "@/server/pack/contents";
import { zipPack } from "@/server/pack/archive";
import { renderPackReport } from "@/server/pack/report";
import { packSigningKey, signManifest, type PackSigningKey } from "@/server/pack/signing";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { storedAnchorHeader, storedBatchHeader } from "@/server/seal/chain";
import { TsaError } from "@/server/seal/tsa";
import { FREETSA, FREETSA_ROOT_PEM, TsaNotConfiguredError } from "@/server/seal/tsa-config";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import {
  anchorPendingBatches,
  defaultTimestamper,
  type Timestamper,
} from "@/server/system/anchoring";
import { usersByIds } from "@/server/system/identity";
import { scheduleNotificationEmail } from "@/server/system/jobs/notifications";
import { parseReasons } from "./control-detail-data";
import { notifyPackReady } from "./notifications";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import { orgDataKey } from "./evidence";
import { sealOrg } from "./seal";
import type { OrgContext } from "./organization";

const DAY_MS = 86_400_000;
/** Période d'un pack : au plus 400 jours (une année d'audit et sa marge). */
export const PACK_MAX_DAYS = 400;

export const packObjectKey = (orgId: string, packId: string) => `orgs/${orgId}/packs/${packId}.zip`;

export interface PackDependencies {
  store: ObjectStore;
  master: () => MasterKey;
  signingKey: () => PackSigningKey;
  timestamper: () => Timestamper;
  baseUrl: string;
  now: () => Date;
}

/** Stockage des archives, partagé par la génération et le téléchargement ; remplaçable par les tests. */
export const packStorage: { store: () => ObjectStore } = { store: () => createObjectStore() };

export function defaultPackDependencies(): PackDependencies {
  return {
    store: packStorage.store(),
    master: () => masterKeyFromEnv(),
    signingKey: () => packSigningKey(),
    timestamper: defaultTimestamper,
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    now: () => new Date(),
  };
}

/** Période [début, fin] en jours UTC ; la fin est incluse. */
export function packPeriod(start: string, end: string, now: Date) {
  const from = new Date(`${start}T00:00:00.000Z`);
  const to = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new ServiceError("BAD_REQUEST", "pack.invalidPeriod");
  }
  if (
    to.getTime() > now.getTime() + DAY_MS ||
    (to.getTime() - from.getTime()) / DAY_MS > PACK_MAX_DAYS
  ) {
    throw new ServiceError("BAD_REQUEST", "pack.invalidPeriod");
  }
  return { from, until: new Date(to.getTime() + DAY_MS) };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function record(
  ctx: OrgContext,
  action: "pack.create" | "pack.download",
  packId: string,
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
    { type: "audit_pack", id: packId },
    metadata,
  );
}

/** Programme la génération ; fournie par la file de jobs (évite une dépendance circulaire). */
export type SchedulePackBuild = (
  tx: OrgTransaction,
  orgId: string,
  packId: string,
) => Promise<unknown>;

export async function createPack(
  ctx: OrgContext,
  input: { systemId: string; periodStart: string; periodEnd: string; language: Locale },
  schedule: SchedulePackBuild,
  now = new Date(),
) {
  packPeriod(input.periodStart, input.periodEnd, now);
  const pack = await withOrgTransaction(ctx.orgId, async (tx) => {
    const system = await tx.aiSystem.findFirst({ where: { id: input.systemId, orgId: ctx.orgId } });
    if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
    const created = await tx.auditPack.create({
      data: {
        orgId: ctx.orgId,
        systemId: system.id,
        requestedByUserId: ctx.userId,
        periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
        language: input.language,
      },
    });
    await schedule(tx, ctx.orgId, created.id);
    return created;
  });
  await record(ctx, "pack.create", pack.id, {
    systemId: input.systemId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    language: input.language,
  });
  return { id: pack.id, status: pack.status };
}

const packView = (p: {
  id: string;
  systemId: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  language: string;
  evidenceCount: number;
  signingKid: string | null;
  manifestSha256: Uint8Array | null;
  lastAnchorSeq: number | null;
  createdAt: Date;
}) => ({
  id: p.id,
  systemId: p.systemId,
  status: p.status,
  periodStart: dayOf(p.periodStart),
  periodEnd: dayOf(p.periodEnd),
  language: p.language,
  evidenceCount: p.evidenceCount,
  signingKid: p.signingKid,
  manifestSha256: p.manifestSha256 ? Buffer.from(p.manifestSha256).toString("hex") : null,
  lastAnchorSeq: p.lastAnchorSeq,
  createdAt: p.createdAt.toISOString(),
});

export async function listPacks(ctx: OrgContext, input: { systemId: string }) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const system = await tx.aiSystem.findFirst({ where: { id: input.systemId, orgId: ctx.orgId } });
    if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
    const packs = await tx.auditPack.findMany({
      where: { systemId: system.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return packs.map(packView);
  });
}

export async function getPack(ctx: OrgContext, input: { packId: string }) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const pack = await tx.auditPack.findFirst({ where: { id: input.packId, orgId: ctx.orgId } });
    if (!pack) throw new ServiceError("NOT_FOUND", "pack.notFound");
    return packView(pack);
  });
}

/** Adresse de téléchargement (route authentifiée, sans jeton dans l'URL). */
export async function packDownloadUrl(ctx: OrgContext, input: { packId: string }) {
  const pack = await getPack(ctx, input);
  if (pack.status !== "READY") throw new ServiceError("CONFLICT", "pack.notReady");
  return { url: `/api/packs/${pack.id}/download` };
}

/** Contenu de l'archive (route de téléchargement), journalisé. */
export async function downloadPack(
  ctx: OrgContext,
  input: { packId: string },
  store: ObjectStore = packStorage.store(),
) {
  const pack = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.auditPack.findFirst({
      where: { id: input.packId, orgId: ctx.orgId },
      include: { system: { select: { slug: true } } },
    }),
  );
  if (!pack) throw new ServiceError("NOT_FOUND", "pack.notFound");
  if (pack.status !== "READY" || !pack.objectKey)
    throw new ServiceError("CONFLICT", "pack.notReady");
  const bytes = await store.get(pack.objectKey);
  if (!bytes) throw new ServiceError("NOT_FOUND", "pack.notFound");
  await record(ctx, "pack.download", pack.id, { size: bytes.length });
  return { bytes, filename: `pack-${pack.system.slug}-${dayOf(pack.createdAt)}.zip` };
}

/** Aperçu chiffré de l'écran E : contrôles, en échec, sans preuve, preuves de la période. */
export async function packPreview(
  ctx: OrgContext,
  input: { systemId: string; periodStart: string; periodEnd: string },
  now = new Date(),
) {
  const { from, until } = packPeriod(input.periodStart, input.periodEnd, now);
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const system = await tx.aiSystem.findFirst({ where: { id: input.systemId, orgId: ctx.orgId } });
    if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
    const instances = await tx.controlInstance.findMany({
      where: { systemId: system.id },
      select: { status: true, notApplicable: true },
    });
    const evidence = await tx.evidenceItem.count({
      where: {
        capturedAt: { gte: from, lt: until },
        OR: [
          { links: { some: { controlInstance: { systemId: system.id } } } },
          { kind: { startsWith: "system." }, payload: { path: ["systemId"], equals: system.id } },
        ],
      },
    });
    const open = instances.filter((i) => !i.notApplicable);
    return {
      controls: instances.length,
      failing: open.filter((i) => i.status === "FAIL").length,
      missing: open.filter((i) => i.status === "MISSING").length,
      evidence,
    };
  });
}

/** VERIFY.md : texte brut (ses accolades sont littérales, hors format ICU), deux variables remplacées. */
async function verifyMarkdown(locale: Locale, params: { kid: string; keysUrl: string }) {
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: "packVerify",
  });
  const body = String(t.raw("body"));
  return `${body.replaceAll("{kid}", params.kid).replaceAll("{keysUrl}", params.keysUrl)}\n`;
}

/**
 * Job `pack.build` : génère l'archive. Une panne passagère (prestataire d'horodatage, stockage) relance le job ; toute
 * autre erreur marque le pack FAILED.
 */
export async function buildPack(
  tx: OrgTransaction,
  orgId: string,
  packId: string,
  deps: PackDependencies = defaultPackDependencies(),
  attempt = { current: 1, max: 1 },
): Promise<"ready" | "failed" | "skipped"> {
  const pack = await tx.auditPack.findFirst({ where: { id: packId, orgId } });
  if (!pack || pack.status === "READY" || pack.status === "FAILED") return "skipped";
  try {
    await assemble(tx, orgId, pack, deps);
    return "ready";
  } catch (error) {
    const transient =
      error instanceof TsaError ? error.retryable : !(error instanceof ServiceError);
    if (transient && attempt.current < attempt.max) throw error;
    await tx.auditPack.update({ where: { id: pack.id }, data: { status: "FAILED" } });
    return "failed";
  }
}

async function assemble(
  tx: OrgTransaction,
  orgId: string,
  pack: {
    id: string;
    systemId: string;
    requestedByUserId: string;
    periodStart: Date;
    periodEnd: Date;
    language: string;
  },
  deps: PackDependencies,
) {
  const now = deps.now();
  const locale: Locale = pack.language === "en" ? "en" : "fr";
  await tx.auditPack.update({ where: { id: pack.id }, data: { status: "BUILDING" } });
  // 1. Scellement des preuves en attente, puis ancrage immédiat (§4.6.2 étape 3 : « à la demande lors d'un export »).
  while (await sealOrg(tx, orgId, now)) {
    // un lot par tour, jusqu'à épuisement
  }
  try {
    await anchorPendingBatches(tx, now, deps.timestamper());
  } catch (error) {
    // Sans prestataire configuré, le pack sort, ses lots marqués non ancrés ; une panne passagère relance le job.
    if (!(error instanceof TsaNotConfiguredError)) throw error;
  }

  const from = pack.periodStart;
  const until = new Date(pack.periodEnd.getTime() + DAY_MS);
  const [organization, system, classification, instances, batchRows] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true } }),
    tx.aiSystem.findUniqueOrThrow({ where: { id: pack.systemId } }),
    tx.classification.findFirst({
      where: { systemId: pack.systemId, status: "SIGNED" },
      orderBy: { signedAt: "desc" },
    }),
    tx.controlInstance.findMany({
      where: { systemId: pack.systemId },
      include: {
        definition: true,
        evidenceLinks: { select: { evidenceId: true } },
        evaluations: { orderBy: { evaluatedAt: "desc" }, take: 1 },
      },
    }),
    tx.sealBatch.findMany({
      where: { orgId, sealedAt: { gte: from, lt: until } },
      orderBy: { seq: "asc" },
      include: { anchor: true },
    }),
  ]);

  // 2. Lots de la période, avec TOUTES leurs feuilles ; preuves divulguées : celles du système.
  const batchIds = batchRows.map((b) => b.id);
  const leaves = batchIds.length
    ? await tx.evidenceItem.findMany({
        where: { sealBatchId: { in: batchIds } },
        orderBy: [{ sealBatchId: "asc" }, { leafIndex: "asc" }],
        select: { id: true, sealBatchId: true, leafHash: true },
      })
    : [];
  const linked = new Set(instances.flatMap((i) => i.evidenceLinks.map((l) => l.evidenceId)));
  const systemEvidence = batchIds.length
    ? await tx.evidenceItem.findMany({
        where: {
          sealBatchId: { in: batchIds },
          kind: { startsWith: "system." },
          payload: { path: ["systemId"], equals: pack.systemId },
        },
        select: { id: true },
      })
    : [];
  const disclosedIds = new Set([
    ...leaves.filter((l) => linked.has(l.id)).map((l) => l.id),
    ...systemEvidence.map((e) => e.id),
  ]);
  const evidenceRows = disclosedIds.size
    ? await tx.evidenceItem.findMany({ where: { id: { in: [...disclosedIds] } } })
    : [];
  const batchSeq = new Map(batchRows.map((b) => [b.id, b.seq]));
  const needsKey = evidenceRows.some((e) => e.attachmentKey && !e.redactedAt);
  const dek = needsKey ? await orgDataKey(tx, orgId, deps.master()) : null;
  const evidence: PackEvidence[] = [];
  for (const e of evidenceRows.sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || (a.id < b.id ? -1 : 1),
  )) {
    let attachment: Uint8Array | null = null;
    if (dek && e.attachmentKey && !e.redactedAt) {
      const sealed = await deps.store.get(e.attachmentKey);
      if (sealed) attachment = decrypt(dek, sealed, `attachment:${orgId}:${e.id}`);
    }
    evidence.push({
      ...e,
      attachment,
      batchSeq: batchSeq.get(e.sealBatchId!)!,
      leafIndex: e.leafIndex!,
    });
  }

  const batches: PackBatch[] = batchRows.map((b) => ({
    header: storedBatchHeader(b),
    batchHash: b.batchHash,
    leafHashes: leaves.filter((l) => l.sealBatchId === b.id).map((l) => l.leafHash),
    anchor:
      b.anchor && b.anchorLeafIndex !== null
        ? { seq: b.anchor.seq, leafIndex: b.anchorLeafIndex }
        : null,
  }));
  const anchorRows = [
    ...new Map(batchRows.filter((b) => b.anchor).map((b) => [b.anchor!.seq, b.anchor!])).values(),
  ];
  const anchors: PackAnchor[] = anchorRows
    .sort((a, b) => a.seq - b.seq)
    .map((a) => ({
      header: storedAnchorHeader(a),
      anchorHash: a.anchorHash,
      batchHashes: a.batchHashes,
      tsa: { name: a.tsaName, policyOid: a.tsaPolicyOid, genTime: a.tsaGenTime },
      token: a.tsaToken,
    }));
  const tsaRoots: Record<string, string> = {};
  if (anchorRows.some((a) => a.tsaName === FREETSA.name)) tsaRoots.freetsa = FREETSA_ROOT_PEM;
  if (process.env.TSA_TRUST_PEM && anchorRows.some((a) => a.tsaName !== FREETSA.name)) {
    tsaRoots.prestataire = process.env.TSA_TRUST_PEM;
  }

  // 3. Contrôles : tous, quel que soit leur statut (§5.3 écran E, règle non négociable).
  const controls: PackControl[] = instances
    .map((i) => {
      const last = i.evaluations[0];
      return {
        key: i.definition.key,
        articleRef: i.definition.articleRef,
        title: i.definition.title as { fr: string; en: string },
        automation: i.definition.automation,
        status: i.notApplicable ? "NOT_APPLICABLE" : i.status,
        notApplicable: i.notApplicable,
        justification: i.notApplicable ? i.naJustification : null,
        evidenceIds: i.evidenceLinks
          .map((l) => l.evidenceId)
          .filter((id) => disclosedIds.has(id))
          .sort(),
        lastEvaluation: last
          ? {
              at: last.evaluatedAt.toISOString(),
              status: last.status,
              evaluatorVersion: last.evaluatorVersion,
              reasons: parseReasons(last.reasons).map(({ code, message }) => ({ code, message })),
            }
          : null,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const key = deps.signingKey();
  const users = await usersByIds([system.ownerUserId]);
  const counts = {
    leaves: leaves.length,
    disclosed: evidence.filter((e) => !e.redactedAt).length,
    batches: batches.length,
    anchors: anchors.length,
    unanchoredBatches: batches.filter((b) => !b.anchor).length,
  };
  const report = await renderPackReport({
    locale,
    generatedAt: now,
    organization: organization.name,
    system: {
      name: system.name,
      intendedPurpose: system.intendedPurpose,
      owner: users.get(system.ownerUserId)?.name ?? null,
      riskTier: system.riskTier,
      role: system.role,
    },
    classification:
      classification && classification.signedAt
        ? {
            tier: classification.tier,
            role: classification.role,
            annexIIIPoints: classification.annexIIIPoints,
            rulesetVersion: classification.rulesetVersion,
            signedAt: classification.signedAt,
            signedBy: classification.signedByName ?? "—",
            signedTitle: classification.signedByTitle ?? "—",
          }
        : null,
    period: { start: dayOf(pack.periodStart), end: dayOf(pack.periodEnd) },
    controls,
    evidence,
    counts,
    signingKid: key.kid,
  });
  const verifyMd = await verifyMarkdown(locale, {
    kid: key.kid,
    keysUrl: new URL("/.well-known/prooflayer-keys.json", deps.baseUrl).toString(),
  });
  const { files, manifest } = buildPackFiles({
    packId: pack.id,
    generatedAt: now,
    language: locale,
    organization,
    system: { id: system.id, name: system.name },
    period: { start: dayOf(pack.periodStart), end: dayOf(pack.periodEnd) },
    libraryVersion: LIBRARY_VERSION,
    controls,
    evidence,
    batches,
    anchors,
    tsaRoots,
    report,
    verifyMd,
  });
  const signed = signManifest(manifest, key);
  const zip = zipPack(files, signed, now);
  // 4. Clé publique publiée (/.well-known/prooflayer-keys.json), archive écrite, pack prêt.
  await tx.signingKey.upsert({
    where: { kid: key.kid },
    create: { kid: key.kid, publicKey: new Uint8Array(key.publicKey) },
    update: {},
  });
  const objectKey = packObjectKey(orgId, pack.id);
  await deps.store.put(objectKey, zip);
  const manifestBytes = Buffer.from(`${JSON.stringify(signed, null, 2)}\n`);
  await tx.auditPack.update({
    where: { id: pack.id },
    data: {
      status: "READY",
      objectKey,
      manifestSha256: new Uint8Array(createHash("sha256").update(manifestBytes).digest()),
      signature: new Uint8Array(Buffer.from(signed.signature.value, "base64")),
      signingKid: key.kid,
      evidenceCount: counts.disclosed,
      lastAnchorSeq: anchors.at(-1)?.header.seq ?? null,
    },
  });
  // 5. Notification au demandeur (email : job notification.email).
  await notifyPackReady(
    tx,
    orgId,
    {
      userId: pack.requestedByUserId,
      packId: pack.id,
      systemId: system.id,
      systemName: system.name,
      evidenceCount: counts.disclosed,
    },
    scheduleNotificationEmail,
  );
}
