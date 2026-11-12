// Pack A — Tous les systèmes du registre (§12.3). 6 contrôles MVP ; AIA-50-02 arrive en V1.
import { ROLES, TIERS, type ControlInput } from "./schema";

const all: Pick<ControlInput, "pack" | "appliesToRoles" | "appliesToTiers"> = {
  pack: "A",
  appliesToRoles: [...ROLES],
  appliesToTiers: [...TIERS],
};

export const PACK_A: ControlInput[] = [
  {
    ...all,
    key: "AIA-06-01",
    articleRef: "Art. 6(2), Annexe III",
    title: { fr: "Classification signée et à jour", en: "Signed, up-to-date classification" },
    statement: {
      fr: "Le système a une classification signée datant de moins de 12 mois et postérieure à la dernière modification de sa fiche.",
      en: "The system has a signed classification less than 12 months old and later than the last change to its record.",
    },
    automation: "AUTOMATED",
    evidenceKinds: ["system.classification.signed", "system.registry.snapshot"],
    freshnessDays: 365,
    evaluatorKey: "internal.classificationFresh",
    params: { maxAgeDays: 365 },
  },
  {
    ...all,
    key: "AIA-06-02",
    articleRef: "Art. 6(3), 6(4)",
    title: { fr: "Dossier d'exemption documenté", en: "Documented exemption file" },
    statement: {
      fr: "En cas d'exemption : évaluation documentée avant mise sur le marché, condition retenue justifiée, absence de profilage motivée.",
      en: "Where an exemption applies: assessment documented before placing on the market, the condition relied on is justified, and the absence of profiling is reasoned.",
    },
    automation: "AUTOMATED",
    evidenceKinds: ["system.exemption.signed"],
    freshnessDays: null,
    evaluatorKey: "internal.exemptionDossier",
    params: {},
  },
  {
    ...all,
    key: "AIA-49-02",
    articleRef: "Art. 49(2), Annexe VIII B",
    title: {
      fr: "Enregistrement du système exempté",
      en: "Registration of the exempted system",
    },
    statement: {
      fr: "Le système exempté est enregistré dans la base de données de l'UE.",
      en: "The exempted system is registered in the EU database.",
    },
    automation: "MANUAL",
    evidenceKinds: ["manual.upload"],
    freshnessDays: null,
    evaluatorKey: "manual.evidencePresent",
    params: {},
  },
  {
    ...all,
    key: "AIA-05-01",
    articleRef: "Art. 5",
    title: {
      fr: "Revue annuelle des pratiques interdites",
      en: "Annual review of prohibited practices",
    },
    statement: {
      fr: "Une revue annuelle atteste l'absence de pratique interdite.",
      en: "An annual review attests that no prohibited practice is in use.",
    },
    automation: "MANUAL",
    evidenceKinds: ["manual.attestation"],
    freshnessDays: 365,
    evaluatorKey: "manual.evidencePresent",
    params: {},
  },
  {
    ...all,
    key: "AIA-04-01",
    articleRef: "Art. 4",
    title: { fr: "Maîtrise de l'IA", en: "AI literacy" },
    statement: {
      fr: "Des mesures de maîtrise de l'IA existent pour les équipes concernées, avec registre de participation.",
      en: "AI literacy measures exist for the teams concerned, with an attendance record.",
    },
    automation: "MANUAL",
    evidenceKinds: ["manual.upload"],
    freshnessDays: null,
    evaluatorKey: "manual.evidencePresent",
    params: {},
  },
  {
    ...all,
    key: "AIA-50-01",
    articleRef: "Art. 50(1)",
    title: {
      fr: "Information des personnes en interaction avec une IA",
      en: "Informing people who interact with an AI",
    },
    statement: {
      fr: "Les personnes sont informées qu'elles interagissent avec une IA.",
      en: "People are informed that they are interacting with an AI.",
    },
    automation: "SEMI_AUTOMATED",
    evidenceKinds: ["github.file.snapshot", "manual.upload"],
    freshnessDays: null,
    evaluatorKey: "document.presentAndFresh",
    params: {},
  },
];
