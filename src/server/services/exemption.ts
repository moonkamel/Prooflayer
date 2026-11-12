// Dossier d'exemption de l'Art. 6(3) (PL-205, §9.4) : exigé par l'Art. 6(4) avant la mise sur le marché ; ses champs
// alimentent l'enregistrement de l'Annexe VIII section B (Art. 49(2)). Un dossier par classification signée exemptée,
// rédigé puis signé (nom, fonction, déclaration, mot de passe) ; signé, il est immuable (trigger exemption_dossier_guard)
// et satisfait le contrôle AIA-06-02, évalué dans la même transaction.
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import {
  EXEMPTION_DOSSIER_EVALUATOR_VERSION,
  evaluateExemptionDossier,
} from "@/server/rules/evaluators/exemption-dossier";
import { organizationById } from "@/server/system/identity";
import { audit, clientIp, type AuditAction } from "./audit";
import { annexVIIIB, annexVIIIBToCsv, annexVIIIBToJson } from "./annex-viii";
import { recordEvaluation } from "./controls";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";
import { assertSignAttemptsLeft, recordSignRefusal, type SignDependencies } from "./sign-guard";
import { slugify } from "./system-registry";

export const EXEMPTION_TARGET = "exemption_dossier";

export interface DossierFields {
  conditionJustification: string;
  profilingJustification: string;
  providerName: string;
  providerAddress: string;
  providerContact: string;
  submitter: string | null;
  representative: string | null;
  tradeName: string;
  memberStates: string[];
}

function dbOf(ctx: OrgContext) {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
}

function record(
  ctx: OrgContext,
  action: AuditAction,
  id: string,
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
    { type: EXEMPTION_TARGET, id },
    metadata,
  );
}

async function systemAndClassification(ctx: OrgContext, systemId: string) {
  const db = dbOf(ctx);
  const system = await db.aiSystem.findFirst({ where: { id: systemId, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  const classification = await db.classification.findFirst({
    where: { systemId: system.id, status: "SIGNED" },
    orderBy: { signedAt: "desc" },
  });
  return { system, classification };
}

type DossierRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof dbOf>["exemptionDossier"]["findFirst"]>>
>;

const viewOf = (d: DossierRow) => ({
  id: d.id,
  status: d.status,
  conditionJustification: d.conditionJustification,
  profilingJustification: d.profilingJustification,
  providerName: d.providerName,
  providerAddress: d.providerAddress,
  providerContact: d.providerContact,
  submitter: d.submitter,
  representative: d.representative,
  tradeName: d.tradeName,
  memberStates: d.memberStates,
  signature: d.signedAt
    ? {
        name: d.signedByName,
        title: d.signedByTitle,
        at: d.signedAt.toISOString(),
        statement: d.signatureStatement,
      }
    : null,
  updatedAt: d.updatedAt.toISOString(),
});

/**
 * Dossier de la classification signée en vigueur. `applicable` est faux si le système n'est pas exempté ;
 * `defaults` préremplit un dossier à créer (nom de l'organisation, nom du système).
 */
export async function getDossier(ctx: OrgContext, input: { systemId: string }) {
  const { system, classification } = await systemAndClassification(ctx, input.systemId);
  const applicable = classification?.tier === "HIGH_RISK_EXEMPT_ART6_3";
  const dossier = applicable
    ? await dbOf(ctx).exemptionDossier.findUnique({
        where: { classificationId: classification.id },
      })
    : null;
  const org = await organizationById(ctx.orgId);
  return {
    applicable,
    classification: classification
      ? {
          id: classification.id,
          tier: classification.tier,
          art63Conditions: classification.art63Conditions,
          annexIIIPoints: classification.annexIIIPoints,
          signedAt: classification.signedAt?.toISOString() ?? null,
        }
      : null,
    dossier: dossier ? viewOf(dossier) : null,
    defaults: { providerName: org?.name ?? "", tradeName: system.name },
  };
}

async function requireExemptClassification(ctx: OrgContext, systemId: string) {
  const { system, classification } = await systemAndClassification(ctx, systemId);
  if (system.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  if (!classification || classification.tier !== "HIGH_RISK_EXEMPT_ART6_3") {
    throw new ServiceError("BAD_REQUEST", "exemption.notExempt");
  }
  return { system, classification };
}

/** Enregistre le dossier en brouillon (création ou mise à jour). Refusé une fois signé. */
export async function saveDossier(
  ctx: OrgContext,
  input: { systemId: string; fields: DossierFields },
) {
  const { system, classification } = await requireExemptClassification(ctx, input.systemId);
  const db = dbOf(ctx);
  const existing = await db.exemptionDossier.findUnique({
    where: { classificationId: classification.id },
  });
  if (existing?.status === "SIGNED") throw new ServiceError("CONFLICT", "exemption.signed");
  const data = { ...input.fields, memberStates: [...new Set(input.fields.memberStates)].sort() };
  const dossier = existing
    ? await db.exemptionDossier.update({ where: { id: existing.id }, data })
    : await db.exemptionDossier.create({
        data: {
          ...data,
          orgId: ctx.orgId,
          systemId: system.id,
          classificationId: classification.id,
        },
      });
  await record(ctx, "exemption.save", dossier.id, {
    systemId: system.id,
    classificationId: classification.id,
    created: !existing,
  });
  return viewOf(dossier);
}

/** Déclaration signée du dossier, dans la langue du signataire. */
export function dossierStatement(locale: string): string {
  return (locale === "en" ? en : fr).exemption.statement;
}

/** Évalue AIA-06-02 pour le système, dans la transaction donnée. */
export async function evaluateExemptionControl(
  tx: OrgTransaction,
  input: { orgId: string; systemId: string; at: Date },
) {
  const system = await tx.aiSystem.findUniqueOrThrow({ where: { id: input.systemId } });
  const classification = await tx.classification.findFirst({
    where: { systemId: input.systemId, status: "SIGNED" },
    orderBy: { signedAt: "desc" },
  });
  const dossier = classification
    ? await tx.exemptionDossier.findFirst({
        where: { classificationId: classification.id, status: "SIGNED" },
      })
    : null;
  const evaluation = evaluateExemptionDossier(
    {
      tier: classification?.tier ?? null,
      classificationId: classification?.id ?? null,
      dossier:
        dossier && dossier.signedAt
          ? {
              id: dossier.id,
              signedAt: dossier.signedAt,
              conditionJustification: dossier.conditionJustification,
              profilingJustification: dossier.profilingJustification,
            }
          : null,
      placedOnMarketAt: system.placedOnMarketAt,
    },
    input.at,
  );
  await recordEvaluation(tx, {
    orgId: input.orgId,
    systemId: input.systemId,
    controlKey: "AIA-06-02",
    evaluatorVersion: EXEMPTION_DOSSIER_EVALUATOR_VERSION,
    evaluation,
    at: input.at,
  });
  return evaluation;
}

/** Signature du dossier : nom, fonction, déclaration, mot de passe (essais limités comme la classification). */
export async function signDossier(
  ctx: OrgContext,
  input: { systemId: string; name: string; title: string; password: string; locale: string },
  deps: SignDependencies,
) {
  const { system, classification } = await requireExemptClassification(ctx, input.systemId);
  const dossier = await dbOf(ctx).exemptionDossier.findUnique({
    where: { classificationId: classification.id },
  });
  if (!dossier) throw new ServiceError("NOT_FOUND", "exemption.noDossier");
  if (dossier.status === "SIGNED") throw new ServiceError("CONFLICT", "exemption.signed");
  await assertSignAttemptsLeft(ctx);
  if (!(await deps.verifyPassword(input.password))) {
    await recordSignRefusal(ctx, {
      systemId: system.id,
      target: "exemption",
      targetId: dossier.id,
    });
    throw new ServiceError("FORBIDDEN", "classification.invalidPassword");
  }
  const signedAt = new Date();
  const evaluation = await withOrgTransaction(ctx.orgId, async (tx) => {
    const { count } = await tx.exemptionDossier.updateMany({
      where: { id: dossier.id, status: "DRAFT" },
      data: {
        status: "SIGNED",
        signedByUserId: ctx.userId,
        signedByName: input.name,
        signedByTitle: input.title,
        signedAt,
        signatureStatement: dossierStatement(input.locale),
      },
    });
    if (count === 0) throw new ServiceError("CONFLICT", "exemption.signed");
    return evaluateExemptionControl(tx, { orgId: ctx.orgId, systemId: system.id, at: signedAt });
  });
  await record(ctx, "exemption.sign", dossier.id, {
    systemId: system.id,
    classificationId: classification.id,
    signedByName: input.name,
    signedByTitle: input.title,
    control: { key: "AIA-06-02", status: evaluation.status },
  });
  return { id: dossier.id, signedAt: signedAt.toISOString(), control: evaluation.status };
}

/** Données du dossier signé (document PDF, export de l'Annexe VIII section B). */
export async function signedDossierData(ctx: OrgContext, input: { systemId: string }) {
  const { system, classification } = await systemAndClassification(ctx, input.systemId);
  const dossier =
    classification && classification.tier === "HIGH_RISK_EXEMPT_ART6_3"
      ? await dbOf(ctx).exemptionDossier.findFirst({
          where: { classificationId: classification.id, status: "SIGNED" },
        })
      : null;
  if (!classification || !dossier) throw new ServiceError("NOT_FOUND", "exemption.noSignedDossier");
  return {
    system: {
      id: system.id,
      name: system.name,
      intendedPurpose: system.intendedPurpose,
      status: system.status,
      placedOnMarketAt: system.placedOnMarketAt?.toISOString() ?? null,
    },
    classification: {
      id: classification.id,
      rulesetVersion: classification.rulesetVersion,
      annexIIIPoints: classification.annexIIIPoints,
      art63Conditions: classification.art63Conditions,
      signedAt: classification.signedAt?.toISOString() ?? null,
      signedByName: classification.signedByName,
    },
    dossier: viewOf(dossier),
  };
}

/** Champs de l'Annexe VIII section B, en CSV ou en JSON (§3.2 E2, PL-205). */
export async function exportAnnexVIIIB(
  ctx: OrgContext,
  input: { systemId: string; format: "csv" | "json" },
) {
  const data = await signedDossierData(ctx, input);
  const fields = annexVIIIB({
    providerName: data.dossier.providerName,
    providerAddress: data.dossier.providerAddress,
    providerContact: data.dossier.providerContact,
    submitter: data.dossier.submitter,
    representative: data.dossier.representative,
    tradeName: data.dossier.tradeName,
    systemReference: data.system.id,
    intendedPurpose: data.system.intendedPurpose,
    art63Conditions: data.classification.art63Conditions,
    conditionJustification: data.dossier.conditionJustification,
    profilingJustification: data.dossier.profilingJustification,
    systemStatus: data.system.status,
    memberStates: data.dossier.memberStates,
  });
  const base = `annexe-viii-b-${slugify(data.system.name)}`;
  return input.format === "csv"
    ? { filename: `${base}.csv`, mimeType: "text/csv", content: annexVIIIBToCsv(fields) }
    : {
        filename: `${base}.json`,
        mimeType: "application/json",
        content: annexVIIIBToJson(fields, new Date()),
      };
}
