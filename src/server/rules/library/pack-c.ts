// Pack C — Fournisseur d'un système à haut risque : organisation, Art. 16 à 21, 43 à 49, 72, 73 (§12.3).
// 12 contrôles MVP ; AIA-25-01 arrive en V1.
import type { ControlInput } from "./schema";

const provider: Pick<ControlInput, "pack" | "appliesToRoles" | "appliesToTiers"> = {
  pack: "C",
  appliesToRoles: ["PROVIDER"],
  appliesToTiers: ["HIGH_RISK"],
};
const jira: ControlInput["evidenceKinds"] = ["jira.issue.snapshot", "jira.issue.transitioned"];
const document: Pick<ControlInput, "automation" | "evaluatorKey" | "freshnessDays" | "params"> = {
  automation: "SEMI_AUTOMATED",
  evaluatorKey: "document.presentAndFresh",
  freshnessDays: null,
  params: {},
};
const manual: Pick<
  ControlInput,
  "automation" | "evaluatorKey" | "evidenceKinds" | "freshnessDays" | "params"
> = {
  automation: "MANUAL",
  evaluatorKey: "manual.evidencePresent",
  evidenceKinds: ["manual.upload"],
  freshnessDays: null,
  params: {},
};

export const PACK_C: ControlInput[] = [
  {
    ...provider,
    ...document,
    key: "AIA-17-01",
    articleRef: "Art. 17(1)(a)",
    title: { fr: "Stratégie réglementaire", en: "Regulatory strategy" },
    statement: {
      fr: "Une stratégie de conformité réglementaire est documentée et approuvée.",
      en: "A regulatory compliance strategy is documented and approved.",
    },
    evidenceKinds: ["github.file.snapshot", "manual.upload"],
  },
  {
    ...provider,
    key: "AIA-17-02",
    articleRef: "Art. 17(1)(b)-(c)",
    title: { fr: "Gestion des changements outillée", en: "Tooled change management" },
    statement: {
      fr: "La gestion des changements est outillée : gabarit de PR avec liste de contrôle, `CODEOWNERS` sur les répertoires de modèle et de données.",
      en: "Change management is tooled: PR template with a checklist, `CODEOWNERS` on the model and data directories.",
    },
    automation: "AUTOMATED",
    evidenceKinds: ["github.file.snapshot"],
    freshnessDays: null,
    evaluatorKey: "github.changeManagementFiles",
    params: {},
  },
  {
    ...provider,
    key: "AIA-17-03",
    articleRef: "Art. 17(1)(m)",
    title: { fr: "Responsabilités nommées", en: "Named responsibilities" },
    statement: {
      fr: "Les responsabilités sont nommées : système, contrôle humain, conformité.",
      en: "Responsibilities are named: system, human oversight, compliance.",
    },
    automation: "AUTOMATED",
    evidenceKinds: ["system.registry.snapshot"],
    freshnessDays: null,
    evaluatorKey: "internal.responsibilitiesNamed",
    params: {},
  },
  {
    ...provider,
    key: "AIA-17-04",
    articleRef: "Art. 17(1)(k), Art. 18",
    title: { fr: "Pack d'audit archivé", en: "Archived audit pack" },
    statement: {
      fr: "Un pack d'audit est archivé au moins tous les 6 mois.",
      en: "An audit pack is archived at least every 6 months.",
    },
    automation: "AUTOMATED",
    evidenceKinds: ["system.pack.generated"],
    freshnessDays: 183,
    evaluatorKey: "internal.packArchived",
    params: { maxIntervalDays: 183 },
  },
  {
    ...provider,
    key: "AIA-20-01",
    articleRef: "Art. 20",
    title: { fr: "Actions correctives", en: "Corrective actions" },
    statement: {
      fr: "Tout incident clos est lié à une action corrective.",
      en: "Every closed incident is linked to a corrective action.",
    },
    automation: "AUTOMATED",
    evidenceKinds: [...jira],
    freshnessDays: null,
    evaluatorKey: "jira.incidentCorrectiveAction",
    params: {},
  },
  {
    ...provider,
    ...document,
    key: "AIA-43-01",
    articleRef: "Art. 43(2), Annexe VI",
    title: {
      fr: "Évaluation par contrôle interne",
      en: "Assessment by internal control",
    },
    statement: {
      fr: "L'évaluation de conformité par contrôle interne est réalisée et signée avant mise sur le marché.",
      en: "The conformity assessment by internal control is carried out and signed before placing on the market.",
    },
    evidenceKinds: ["manual.upload", "manual.attestation"],
  },
  {
    ...provider,
    ...manual,
    key: "AIA-47-01",
    articleRef: "Art. 47, Annexe V",
    title: { fr: "Déclaration UE de conformité", en: "EU declaration of conformity" },
    statement: {
      fr: "La déclaration UE de conformité est établie, signée et tenue à jour.",
      en: "The EU declaration of conformity is drawn up, signed and kept up to date.",
    },
  },
  {
    ...provider,
    ...manual,
    key: "AIA-48-01",
    articleRef: "Art. 48",
    title: { fr: "Marquage CE", en: "CE marking" },
    statement: { fr: "Le marquage CE est apposé.", en: "The CE marking is affixed." },
  },
  {
    ...provider,
    ...manual,
    key: "AIA-49-01",
    articleRef: "Art. 49(1), Annexe VIII A",
    title: { fr: "Enregistrement dans la base de l'UE", en: "Registration in the EU database" },
    statement: {
      fr: "Le système est enregistré dans la base de données de l'UE.",
      en: "The system is registered in the EU database.",
    },
  },
  {
    ...provider,
    ...document,
    key: "AIA-72-01",
    articleRef: "Art. 72",
    title: {
      fr: "Plan de surveillance après commercialisation",
      en: "Post-market monitoring plan",
    },
    statement: {
      fr: "Un plan de surveillance après commercialisation est documenté.",
      en: "A post-market monitoring plan is documented.",
    },
    evidenceKinds: ["github.file.snapshot", "manual.upload"],
  },
  {
    ...provider,
    key: "AIA-72-02",
    articleRef: "Art. 72(2)",
    title: { fr: "Revue des données de surveillance", en: "Monitoring data review" },
    statement: {
      fr: "Les données de surveillance sont revues au moins chaque trimestre.",
      en: "Monitoring data is reviewed at least every quarter.",
    },
    automation: "AUTOMATED",
    evidenceKinds: [...jira],
    freshnessDays: 92,
    evaluatorKey: "jira.monitoringReviewed",
    params: { reviewDays: 92 },
  },
  {
    ...provider,
    key: "AIA-73-01",
    articleRef: "Art. 73(2)-(4)",
    title: { fr: "Notification des incidents graves", en: "Serious incident reporting" },
    statement: {
      fr: "Tout incident grave est notifié dans le délai applicable (15, 10 ou 2 jours).",
      en: "Every serious incident is reported within the applicable deadline (15, 10 or 2 days).",
    },
    automation: "AUTOMATED",
    evidenceKinds: [...jira],
    freshnessDays: null,
    evaluatorKey: "jira.seriousIncidentNotified",
    params: { defaultDays: 15, deathDays: 10, criticalInfrastructureDays: 2 },
  },
];
