// Schéma d'un contrôle de la bibliothèque (PL-206, §3.2 E6, §4.3.2 `ControlDefinition`) : identifiant stable,
// référence d'article, énoncé testable, rôles et catégories concernés, types de preuves acceptés, durée de
// fraîcheur, clé d'évaluateur. Les textes sont en français et en anglais.
import { z } from "zod";
import { isEvaluatorKey } from "../evaluator-keys";

const bilingual = z.object({ fr: z.string().trim().min(1), en: z.string().trim().min(1) }).strict();

export const PACKS = ["A", "B", "C", "D"] as const;
export const ROLES = ["PROVIDER", "DEPLOYER", "IMPORTER", "DISTRIBUTOR"] as const;
/** Catégories d'un système classifié et signable (une pratique interdite ne se signe pas). */
export const TIERS = [
  "NOT_AI_SYSTEM",
  "OUT_OF_SCOPE",
  "HIGH_RISK",
  "HIGH_RISK_EXEMPT_ART6_3",
  "LIMITED_TRANSPARENCY",
  "MINIMAL",
] as const;

/** Types de preuves (EvidenceItem.kind). GitHub et Jira : §9.5 PL-305 et §9.6 PL-404. */
export const EVIDENCE_KINDS = [
  "github.pull_request.merged",
  "github.review.submitted",
  "github.workflow_run.completed",
  "github.branch_protection.snapshot",
  "github.file.snapshot",
  "github.release.published",
  "github.security_alerts.snapshot",
  "jira.issue.snapshot",
  "jira.issue.transitioned",
  "manual.upload",
  "manual.attestation",
  "system.classification.signed",
  "system.exemption.signed",
  "system.registry.snapshot",
  "system.pack.generated",
] as const;

export const controlSchema = z
  .object({
    key: z.string().regex(/^AIA-\d{2}-\d{2}$/u),
    articleRef: z.string().regex(/^Art\. /u),
    pack: z.enum(PACKS),
    title: bilingual,
    statement: bilingual,
    appliesToRoles: z.array(z.enum(ROLES)).min(1),
    appliesToTiers: z.array(z.enum(TIERS)).min(1),
    automation: z.enum(["AUTOMATED", "SEMI_AUTOMATED", "MANUAL"]),
    evidenceKinds: z.array(z.enum(EVIDENCE_KINDS)).min(1),
    /** Durée de validité d'une preuve en jours ; null : sans péremption. */
    freshnessDays: z.number().int().positive().nullable(),
    evaluatorKey: z.string().refine(isEvaluatorKey, "clé d'évaluateur inconnue"),
    /** Seuils lus par l'évaluateur. */
    params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  })
  .strict();

export type Control = z.infer<typeof controlSchema>;
export type ControlInput = z.input<typeof controlSchema>;
