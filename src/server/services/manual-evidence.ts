// Preuves manuelles et attestations (PL-405, §3.2 E5) : ce qui ne laisse de trace dans aucun outil.
// - Téléversement direct vers le stockage par adresse signée (`evidence.createUploadUrl`), puis enregistrement
//   (`evidence.registerUpload`) : le serveur relit le fichier de la zone d'arrivée, en contrôle le type (signature du
//   contenu) et la taille (25 Mo au plus), calcule son empreinte SHA-256 (scellée avec la preuve), le chiffre sous la
//   clé de l'organisation puis efface la zone d'arrivée. Date de validité obligatoire.
// - Attestation (`evidence.attest`) : déclaration textuelle signée par un utilisateur nommé, avec sa fonction et une
//   date de validité, confirmée par mot de passe à essais limités.
// Ces preuves sont déclaratives (`declarative`), rattachées aux contrôles choisis (`EvidenceLink` par l'utilisateur),
// et passent le contrôle en STALE à expiration.
import { createHash, randomUUID } from "node:crypto";
import { withOrgTransaction } from "@/server/db";
import { signToken, tokenSecret, verifyToken } from "@/server/crypto/signed-token";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import { scheduleEvaluations } from "./evaluation";
import { createEvidence } from "./evidence";
import type { OrgContext } from "./organization";
import { assertSignAttemptsLeft, recordSignRefusal, type SignDependencies } from "./sign-guard";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_PURPOSE = "evidence-upload";
const UPLOAD_URL_TTL_S = 10 * 60;
const UPLOAD_TOKEN_TTL_MS = 30 * 60_000;

/** Types acceptés (§3.2 E5) : extension, type MIME et contrôle du contenu. */
export const UPLOAD_TYPES = {
  pdf: { mime: "application/pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  png: { mime: "image/png" },
  jpg: { mime: "image/jpeg" },
  jpeg: { mime: "image/jpeg" },
  md: { mime: "text/markdown" },
  csv: { mime: "text/csv" },
} as const;
type Extension = keyof typeof UPLOAD_TYPES;

const startsWith = (data: Buffer, bytes: number[]) => bytes.every((b, i) => data[i] === b);

/** Le contenu correspond-il au type annoncé ? Fonction pure. */
export function contentMatches(data: Buffer, mime: string): boolean {
  switch (mime) {
    case "application/pdf":
      return startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "image/png":
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case UPLOAD_TYPES.docx.mime:
      return startsWith(data, [0x50, 0x4b, 0x03, 0x04]) && data.includes("word/");
    case "text/markdown":
    case "text/csv":
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(data);
        return !data.includes(0);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Extension et type MIME cohérents et acceptés ; sinon BAD_REQUEST. */
export function checkUploadType(filename: string, contentType: string): Extension {
  const ext = filename.toLowerCase().match(/\.([a-z]+)$/u)?.[1] as Extension | undefined;
  if (!ext || !(ext in UPLOAD_TYPES) || UPLOAD_TYPES[ext].mime !== contentType) {
    throw new ServiceError("BAD_REQUEST", "evidence.unsupportedType");
  }
  return ext;
}

export interface ManualEvidenceDependencies {
  store: ObjectStore;
  secret: string;
  now: () => Date;
}
const defaults = (): ManualEvidenceDependencies => ({
  store: createObjectStore(),
  secret: tokenSecret(),
  now: () => new Date(),
});

const dbOf = (ctx: OrgContext) => {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
};

/** Contrôles de l'organisation, applicables, sur des systèmes non archivés. */
async function assertControls(ctx: OrgContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await dbOf(ctx).controlInstance.findMany({
    where: { id: { in: unique }, orgId: ctx.orgId, system: { archivedAt: null } },
    select: { id: true, systemId: true },
  });
  if (found.length !== unique.length) throw new ServiceError("NOT_FOUND", "control.notFound");
  return found;
}

function validUntilOf(value: string, now: Date) {
  const date = new Date(`${value}T23:59:59.999Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(date.getTime()) || date <= now) {
    throw new ServiceError("BAD_REQUEST", "evidence.invalidValidity");
  }
  return date;
}

/** `evidence.createUploadUrl` : adresse de dépôt direct (10 minutes) et jeton d'enregistrement (30 minutes). */
export async function createUploadUrl(
  ctx: OrgContext,
  input: { controlInstanceIds: string[]; filename: string; contentType: string; size: number },
  deps: ManualEvidenceDependencies = defaults(),
) {
  checkUploadType(input.filename, input.contentType);
  if (input.size <= 0 || input.size > MAX_UPLOAD_BYTES) {
    throw new ServiceError("BAD_REQUEST", "evidence.tooLarge");
  }
  await assertControls(ctx, input.controlInstanceIds);
  const uploadId = randomUUID().replaceAll("-", "");
  const key = `orgs/${ctx.orgId}/incoming/${uploadId}`;
  const uploadUrl = await deps.store.presignPut(key, input.contentType, UPLOAD_URL_TTL_S);
  const token = signToken(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      uploadId,
      key,
      filename: input.filename,
      contentType: input.contentType,
      controlInstanceIds: [...new Set(input.controlInstanceIds)],
    },
    {
      secret: deps.secret,
      purpose: UPLOAD_PURPOSE,
      expiresAt: new Date(deps.now().getTime() + UPLOAD_TOKEN_TTL_MS),
    },
  );
  return { uploadUrl, token, contentType: input.contentType };
}

interface UploadClaims {
  orgId: string;
  userId: string;
  uploadId: string;
  key: string;
  filename: string;
  contentType: string;
  controlInstanceIds: string[];
}

/** `evidence.registerUpload` : contrôle, empreinte, chiffrement, preuve déclarative rattachée aux contrôles. */
export async function registerUpload(
  ctx: OrgContext,
  input: { token: string; validUntil: string; title?: string | null },
  deps: ManualEvidenceDependencies = defaults(),
) {
  const now = deps.now();
  const claims = verifyToken(input.token, {
    secret: deps.secret,
    purpose: UPLOAD_PURPOSE,
    now,
  }) as UploadClaims | null;
  if (!claims || claims.orgId !== ctx.orgId || claims.userId !== ctx.userId) {
    throw new ServiceError("BAD_REQUEST", "evidence.invalidUpload");
  }
  const validUntil = validUntilOf(input.validUntil, now);
  const instances = await assertControls(ctx, claims.controlInstanceIds);
  const data = await deps.store.get(claims.key);
  if (!data) throw new ServiceError("BAD_REQUEST", "evidence.uploadMissing");
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) {
    await deps.store.delete(claims.key);
    throw new ServiceError("BAD_REQUEST", "evidence.tooLarge");
  }
  if (!contentMatches(data, claims.contentType)) {
    await deps.store.delete(claims.key);
    throw new ServiceError("BAD_REQUEST", "evidence.contentMismatch");
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  const title = input.title?.trim() || claims.filename;

  const evidenceId = await withOrgTransaction(ctx.orgId, async (tx) => {
    const result = await createEvidence(
      tx,
      ctx.orgId,
      {
        kind: "manual.upload",
        source: "MANUAL",
        capturedVia: "UPLOAD",
        sourceRef: `upload:${claims.uploadId}`,
        dedupeKey: `manual:upload:${claims.uploadId}`,
        occurredAt: now,
        summary: title.slice(0, 200),
        actor: { login: ctx.userId },
        payload: {
          title: title.slice(0, 200),
          filename: claims.filename.slice(0, 200),
          contentType: claims.contentType,
          size: data.length,
          sha256,
          validUntil: validUntil.toISOString(),
        },
        declarative: true,
        validUntil,
        createdByUserId: ctx.userId,
        attachment: { data, mime: claims.contentType },
      },
      { store: deps.store, now: deps.now },
    );
    if (!result.created) throw new ServiceError("CONFLICT", "evidence.alreadyRegistered");
    await tx.evidenceLink.createMany({
      data: instances.map((i) => ({
        evidenceId: result.id,
        controlInstanceId: i.id,
        orgId: ctx.orgId,
        linkedBy: ctx.userId,
      })),
      skipDuplicates: true,
    });
    await scheduleEvaluations(
      tx,
      ctx.orgId,
      [{ id: result.id, kind: "manual.upload", resourceId: null }],
      scheduleEvaluation,
    );
    return result.id;
  });
  await deps.store.delete(claims.key);
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "evidence.upload",
    { type: "evidence", id: evidenceId },
    {
      filename: claims.filename,
      contentType: claims.contentType,
      size: data.length,
      sha256,
      validUntil: validUntil.toISOString(),
      controlInstanceIds: instances.map((i) => i.id),
    },
  );
  return { evidenceId, sha256 };
}

/** `evidence.attest` : attestation signée (nom, fonction, déclaration, validité), confirmée par mot de passe. */
export async function attest(
  ctx: OrgContext,
  input: {
    controlInstanceIds: string[];
    statement: string;
    name: string;
    title: string;
    validUntil: string;
    password: string;
  },
  deps: SignDependencies & { now?: () => Date },
) {
  const now = deps.now?.() ?? new Date();
  const validUntil = validUntilOf(input.validUntil, now);
  const instances = await assertControls(ctx, input.controlInstanceIds);
  await assertSignAttemptsLeft(ctx);
  if (!(await deps.verifyPassword(input.password))) {
    await recordSignRefusal(ctx, {
      systemId: instances[0]!.systemId,
      target: "evidence",
      targetId: instances[0]!.id,
    });
    throw new ServiceError("FORBIDDEN", "classification.invalidPassword");
  }
  const attestationId = randomUUID().replaceAll("-", "");
  const evidenceId = await withOrgTransaction(ctx.orgId, async (tx) => {
    const result = await createEvidence(
      tx,
      ctx.orgId,
      {
        kind: "manual.attestation",
        source: "MANUAL",
        capturedVia: "ATTESTATION",
        sourceRef: `attestation:${attestationId}`,
        dedupeKey: `manual:attestation:${attestationId}`,
        occurredAt: now,
        summary: `${input.name} · ${input.title}`.slice(0, 200),
        actor: { login: ctx.userId },
        payload: {
          statement: input.statement,
          signerName: input.name,
          signerTitle: input.title,
          signedAt: now.toISOString(),
          validUntil: validUntil.toISOString(),
        },
        declarative: true,
        validUntil,
        createdByUserId: ctx.userId,
      },
      { now: () => now },
    );
    await tx.evidenceLink.createMany({
      data: instances.map((i) => ({
        evidenceId: result.id,
        controlInstanceId: i.id,
        orgId: ctx.orgId,
        linkedBy: ctx.userId,
      })),
      skipDuplicates: true,
    });
    await scheduleEvaluations(
      tx,
      ctx.orgId,
      [{ id: result.id, kind: "manual.attestation", resourceId: null }],
      scheduleEvaluation,
    );
    return result.id;
  });
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "evidence.attest",
    { type: "evidence", id: evidenceId },
    {
      signerName: input.name,
      signerTitle: input.title,
      validUntil: validUntil.toISOString(),
      controlInstanceIds: instances.map((i) => i.id),
    },
  );
  return { evidenceId };
}
