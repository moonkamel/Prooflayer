// Jeu de cas du moteur de classification (PL-202, §9.4). Écrit avant le moteur : chaque cas fixe le résultat attendu.
// Source : « LD » = exemple cité par le prompt-type d'après le projet de lignes directrices du 19 mai 2026 ;
// « AIA » = cas construit d'après le texte du règlement (article cité). Tous les cas sont à relire par l'avocat
// partenaire avant la fin du sprint 2 (DoD du §9.4) ; un cas corrigé se modifie ici, jamais dans le moteur seul.
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import type { Answers, AnnexIIIPoint, Art63Condition } from "./answers";

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9";

export interface ClassificationCase {
  name: string;
  source: "LD" | "AIA";
  /** Article ou considérant qui fonde le résultat attendu. */
  reference: string;
  answers: Answers;
  expected: {
    tier: Exclude<RiskTier, "UNCLASSIFIED">;
    role: Extract<AiActRole, "PROVIDER" | "DEPLOYER">;
    decidedBy: RuleId;
    annexIIIPoints: AnnexIIIPoint[];
    art63Conditions: Art63Condition[];
    involvesProfiling: boolean;
  };
}

/** Système d'IA dans le champ, développé par l'entreprise, sans autre caractéristique. */
const BASE: Answers = {
  isAiSystem: true,
  inScope: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIPoints: [],
  performsProfiling: false,
  art63Conditions: [],
  interactsWithPersons: false,
  generatesSyntheticContent: false,
  developsSystem: true,
  ownBrand: false,
  substantialModification: false,
  changedPurpose: false,
};

/** Un déployeur : ni développement, ni marque propre, ni modification, ni changement de finalité. */
const DEPLOYER: Partial<Answers> = { developsSystem: false };

type Expected = ClassificationCase["expected"];

function c(
  name: string,
  source: ClassificationCase["source"],
  reference: string,
  answers: Partial<Answers>,
  expected: Partial<Expected> & Pick<Expected, "tier" | "decidedBy">,
): ClassificationCase {
  return {
    name,
    source,
    reference,
    answers: { ...BASE, ...answers },
    expected: {
      role: "PROVIDER",
      annexIIIPoints: [],
      art63Conditions: [],
      involvesProfiling: false,
      ...expected,
    },
  };
}

const notAi = { tier: "NOT_AI_SYSTEM", decidedBy: "R1" } as const;
const outOfScope = { tier: "OUT_OF_SCOPE", decidedBy: "R2" } as const;
const prohibited = { tier: "PROHIBITED", decidedBy: "R3" } as const;
const annexI = { tier: "HIGH_RISK", decidedBy: "R4" } as const;
const limited = { tier: "LIMITED_TRANSPARENCY", decidedBy: "R8" } as const;
const minimal = { tier: "MINIMAL", decidedBy: "R9" } as const;

export const CASES: readonly ClassificationCase[] = [
  // R1 — Pas un système d'IA (Art. 3(1), considérant 12)
  c(
    "Moteur de règles métier écrit à la main",
    "AIA",
    "Art. 3(1), cons. 12",
    { isAiSystem: false },
    notAi,
  ),
  c(
    "Tableur de calcul de primes à formules fixées",
    "AIA",
    "Art. 3(1), cons. 12",
    { isAiSystem: false },
    notAi,
  ),
  c(
    "Tableau de bord de statistiques descriptives",
    "AIA",
    "Art. 3(1), cons. 12",
    { isAiSystem: false },
    notAi,
  ),
  c(
    "Règles déterministes appliquées au tri de CV : la définition prime sur le domaine",
    "AIA",
    "Art. 3(1), cons. 12",
    { isAiSystem: false, annexIIIPoints: ["4(a)"], performsProfiling: true },
    notAi,
  ),

  // R2 — Hors du champ (Art. 2)
  c("Système exclusivement militaire", "AIA", "Art. 2(3)", { inScope: false }, outOfScope),
  c(
    "Modèle développé pour la seule recherche scientifique",
    "AIA",
    "Art. 2(6)",
    { inScope: false },
    outOfScope,
  ),
  c(
    "Prototype en essai avant mise sur le marché",
    "AIA",
    "Art. 2(8)",
    { inScope: false },
    outOfScope,
  ),
  c(
    "Usage personnel non professionnel d'un outil de reconnaissance d'émotions",
    "AIA",
    "Art. 2(10)",
    { inScope: false, prohibitedPractices: ["f"], ...DEPLOYER },
    { ...outOfScope, role: "DEPLOYER" },
  ),

  // R3 — Pratiques interdites (Art. 5)
  c(
    "Techniques subliminales altérant le comportement",
    "AIA",
    "Art. 5(1)(a)",
    { prohibitedPractices: ["a"] },
    prohibited,
  ),
  c(
    "Exploitation de la vulnérabilité liée à l'âge",
    "AIA",
    "Art. 5(1)(b)",
    { prohibitedPractices: ["b"] },
    prohibited,
  ),
  c(
    "Notation sociale entraînant un traitement défavorable",
    "AIA",
    "Art. 5(1)(c)",
    { prohibitedPractices: ["c"] },
    prohibited,
  ),
  c(
    "Prédiction d'infraction fondée sur le seul profilage",
    "AIA",
    "Art. 5(1)(d)",
    { prohibitedPractices: ["d"], performsProfiling: true },
    prohibited,
  ),
  c(
    "Moissonnage non ciblé d'images faciales",
    "AIA",
    "Art. 5(1)(e)",
    { prohibitedPractices: ["e"] },
    prohibited,
  ),
  c(
    "Reconnaissance des émotions des salariés en entretien",
    "AIA",
    "Art. 5(1)(f), Annexe III 1(c)",
    { prohibitedPractices: ["f"], annexIIIPoints: ["1(c)"] },
    prohibited,
  ),
  c(
    "Catégorisation biométrique selon l'orientation politique",
    "AIA",
    "Art. 5(1)(g)",
    { prohibitedPractices: ["g"], annexIIIPoints: ["1(b)"] },
    prohibited,
  ),
  c(
    "Identification biométrique à distance en temps réel par la police dans l'espace public",
    "AIA",
    "Art. 5(1)(h)",
    { prohibitedPractices: ["h"], annexISafetyComponent: true, ...DEPLOYER },
    { ...prohibited, role: "DEPLOYER" },
  ),

  // R4 — Composant de sécurité d'un produit de l'Annexe I (Art. 6(1))
  c(
    "Composant de sécurité d'un dispositif médical",
    "AIA",
    "Art. 6(1), Annexe I",
    { annexISafetyComponent: true },
    annexI,
  ),
  c(
    "Composant de sécurité d'une machine",
    "AIA",
    "Art. 6(1), Annexe I",
    { annexISafetyComponent: true },
    annexI,
  ),
  c(
    "Composant de sécurité d'un jouet connecté qui dialogue avec l'enfant",
    "AIA",
    "Art. 6(1), Annexe I",
    { annexISafetyComponent: true, interactsWithPersons: true },
    annexI,
  ),
  c(
    "Composant de sécurité aussi visé par l'Annexe III : l'Art. 6(1) conclut avant l'Art. 6(3)",
    "AIA",
    "Art. 6(1)",
    { annexISafetyComponent: true, annexIIIPoints: ["2"], art63Conditions: ["a"] },
    annexI,
  ),

  // R5 — Annexe III et profilage : haut risque quelle que soit la condition de l'Art. 6(3)
  c(
    "Appariement et classement de candidatures",
    "LD",
    "Annexe III 4(a), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["4(a)"], performsProfiling: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["4(a)"], involvesProfiling: true },
  ),
  c(
    "Affectation de tâches selon les traits personnels des salariés",
    "LD",
    "Annexe III 4(b), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["4(b)"], performsProfiling: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["4(b)"], involvesProfiling: true },
  ),
  c(
    "Score de crédit à la consommation",
    "LD",
    "Annexe III 5(b), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["5(b)"], performsProfiling: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["5(b)"], involvesProfiling: true },
  ),
  c(
    "Analyse de CV qui établit aussi un profil : la condition (a) est écartée",
    "AIA",
    "Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["4(a)"], performsProfiling: true, art63Conditions: ["a"] },
    {
      tier: "HIGH_RISK",
      decidedBy: "R5",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["a"],
      involvesProfiling: true,
    },
  ),
  c(
    "Tarification en assurance santé",
    "AIA",
    "Annexe III 5(c), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["5(c)"], performsProfiling: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["5(c)"], involvesProfiling: true },
  ),
  c(
    "Suivi des performances des salariés, toutes conditions déclarées",
    "AIA",
    "Annexe III 4(b), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["4(b)"], performsProfiling: true, art63Conditions: ["d", "c", "b", "a"] },
    {
      tier: "HIGH_RISK",
      decidedBy: "R5",
      annexIIIPoints: ["4(b)"],
      art63Conditions: ["a", "b", "c", "d"],
      involvesProfiling: true,
    },
  ),
  c(
    "Apprentissage adaptatif qui évalue chaque élève",
    "AIA",
    "Annexe III 3(b), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["3(b)"], performsProfiling: true, interactsWithPersons: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["3(b)"], involvesProfiling: true },
  ),
  c(
    "Évaluation du risque de récidive",
    "AIA",
    "Annexe III 6(d), Art. 6(3) dernier alinéa",
    { annexIIIPoints: ["6(d)"], performsProfiling: true, ...DEPLOYER },
    {
      tier: "HIGH_RISK",
      decidedBy: "R5",
      role: "DEPLOYER",
      annexIIIPoints: ["6(d)"],
      involvesProfiling: true,
    },
  ),

  // R6 — Annexe III sans condition de l'Art. 6(3) (Art. 6(2))
  c(
    "Correction automatisée de copies",
    "AIA",
    "Annexe III 3(b), Art. 6(2)",
    { annexIIIPoints: ["3(b)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["3(b)"] },
  ),
  c(
    "Plateforme d'admission dans l'enseignement supérieur",
    "AIA",
    "Annexe III 3(a), Art. 6(2)",
    { annexIIIPoints: ["3(a)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["3(a)"] },
  ),
  c(
    "Télésurveillance d'examens",
    "AIA",
    "Annexe III 3(d), Art. 6(2)",
    { annexIIIPoints: ["3(d)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["3(d)"] },
  ),
  c(
    "Tri des appels d'urgence",
    "AIA",
    "Annexe III 5(d), Art. 6(2)",
    { annexIIIPoints: ["5(d)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["5(d)"] },
  ),
  c(
    "Supervision d'un réseau de distribution d'eau",
    "AIA",
    "Annexe III 2, Art. 6(2)",
    { annexIIIPoints: ["2"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["2"] },
  ),
  c(
    "Identification biométrique à distance a posteriori pour un site privé",
    "AIA",
    "Annexe III 1(a), Art. 6(2)",
    { annexIIIPoints: ["1(a)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["1(a)"] },
  ),
  c(
    "Aide aux juridictions dans l'interprétation des faits",
    "AIA",
    "Annexe III 8(a), Art. 6(2)",
    { annexIIIPoints: ["8(a)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["8(a)"] },
  ),
  c(
    "Éligibilité aux prestations sociales",
    "AIA",
    "Annexe III 5(a), Art. 6(2)",
    { annexIIIPoints: ["5(a)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["5(a)"] },
  ),
  c(
    "Recrutement et gestion des carrières : points multiples, dans l'ordre de l'Annexe",
    "AIA",
    "Annexe III 4(a) et 4(b), Art. 6(2)",
    { annexIIIPoints: ["4(b)", "4(a)", "4(b)"] },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["4(a)", "4(b)"] },
  ),

  // R7 — Annexe III avec une condition de l'Art. 6(3), sans profilage (Art. 6(3) et 6(4))
  c(
    "Analyseur de CV qui extrait les champs",
    "LD",
    "Annexe III 4(a), Art. 6(3)(a)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["a"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["a"],
    },
  ),
  c(
    "Planification d'entretiens",
    "LD",
    "Annexe III 4(a), Art. 6(3)(a)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["a"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["a"],
    },
  ),
  c(
    "Reformulation d'une offre d'emploi rédigée par un recruteur",
    "AIA",
    "Annexe III 4(a), Art. 6(3)(b)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["b"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["b"],
    },
  ),
  c(
    "Détection d'écarts dans la notation d'un correcteur, sans la remplacer",
    "AIA",
    "Annexe III 3(b), Art. 6(3)(c)",
    { annexIIIPoints: ["3(b)"], art63Conditions: ["c"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["3(b)"],
      art63Conditions: ["c"],
    },
  ),
  c(
    "Traduction des pièces d'un dossier de candidature",
    "AIA",
    "Annexe III 4(a), Art. 6(3)(d)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["d"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["d"],
    },
  ),
  c(
    "Plusieurs conditions déclarées, restituées dans l'ordre de l'Art. 6(3)",
    "AIA",
    "Art. 6(3)(a) et (d)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["d", "a", "d"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["a", "d"],
    },
  ),
  c(
    "Dédoublonnage des demandes de prestations",
    "AIA",
    "Annexe III 5(a), Art. 6(3)(a)",
    { annexIIIPoints: ["5(a)"], art63Conditions: ["a"] },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["5(a)"],
      art63Conditions: ["a"],
    },
  ),
  c(
    "Assistant de prise de rendez-vous qui dialogue avec les candidats : l'exemption conclut avant l'Art. 50",
    "AIA",
    "Art. 6(3)(a)",
    { annexIIIPoints: ["4(a)"], art63Conditions: ["a"], interactsWithPersons: true },
    {
      tier: "HIGH_RISK_EXEMPT_ART6_3",
      decidedBy: "R7",
      annexIIIPoints: ["4(a)"],
      art63Conditions: ["a"],
    },
  ),

  // R8 — Obligations de transparence (Art. 50)
  c(
    "Agent conversationnel de service client",
    "AIA",
    "Art. 50(1)",
    { interactsWithPersons: true },
    limited,
  ),
  c(
    "Générateur d'images de produits",
    "AIA",
    "Art. 50(2)",
    { generatesSyntheticContent: true },
    limited,
  ),
  c(
    "Synthèse vocale de messages d'accueil",
    "AIA",
    "Art. 50(2)",
    { generatesSyntheticContent: true },
    limited,
  ),
  c(
    "Avatar conversationnel qui génère sa voix",
    "AIA",
    "Art. 50(1) et 50(2)",
    { interactsWithPersons: true, generatesSyntheticContent: true },
    limited,
  ),
  c(
    "Assistant de rédaction de courriels",
    "AIA",
    "Art. 50(2)",
    { generatesSyntheticContent: true },
    limited,
  ),
  c(
    "Agent conversationnel RH qui répond aux questions des salariés",
    "AIA",
    "Art. 50(1)",
    { interactsWithPersons: true, ...DEPLOYER },
    { ...limited, role: "DEPLOYER" },
  ),

  // R9 — Risque minimal
  c(
    "Détection de fraude financière, exclue du point 5(b)",
    "LD",
    "Annexe III 5(b) (exclusion de la fraude)",
    {},
    minimal,
  ),
  c("Filtre anti-spam", "AIA", "Art. 6, Art. 50 non applicables", {}, minimal),
  c("Maintenance prédictive de machines", "AIA", "Art. 6, Art. 50 non applicables", {}, minimal),
  c(
    "Recommandation de produits avec profilage hors Annexe III",
    "AIA",
    "Art. 6(3) non applicable hors Annexe III",
    { performsProfiling: true },
    minimal,
  ),
  c(
    "Affectation de tournées selon disponibilité et lieu, non visée par le point 4(b)",
    "AIA",
    "Annexe III 4(b) (critères neutres)",
    {},
    minimal,
  ),

  // Rôle — Art. 3(3), 3(4) et bascule en fournisseur de l'Art. 25(1)
  c(
    "Recruteur qui utilise un ATS tiers de classement",
    "AIA",
    "Art. 3(4), Annexe III 4(a)",
    { annexIIIPoints: ["4(a)"], performsProfiling: true, ...DEPLOYER },
    {
      tier: "HIGH_RISK",
      decidedBy: "R5",
      role: "DEPLOYER",
      annexIIIPoints: ["4(a)"],
      involvesProfiling: true,
    },
  ),
  c(
    "Revendeur qui appose sa marque sur un système de score tiers",
    "AIA",
    "Art. 25(1)(a)",
    { annexIIIPoints: ["5(b)"], performsProfiling: true, ...DEPLOYER, ownBrand: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["5(b)"], involvesProfiling: true },
  ),
  c(
    "Client qui réentraîne un modèle d'évaluation de candidats acheté",
    "AIA",
    "Art. 25(1)(b)",
    { annexIIIPoints: ["4(a)"], ...DEPLOYER, substantialModification: true },
    { tier: "HIGH_RISK", decidedBy: "R6", annexIIIPoints: ["4(a)"] },
  ),
  c(
    "Agent conversationnel généraliste réaffecté au tri de candidatures",
    "AIA",
    "Art. 25(1)(c)",
    { annexIIIPoints: ["4(a)"], performsProfiling: true, ...DEPLOYER, changedPurpose: true },
    { tier: "HIGH_RISK", decidedBy: "R5", annexIIIPoints: ["4(a)"], involvesProfiling: true },
  ),
  c(
    "Banque qui utilise un outil tiers de détection de fraude",
    "AIA",
    "Art. 3(4)",
    { ...DEPLOYER },
    { ...minimal, role: "DEPLOYER" },
  ),
  c(
    "Éditeur qui développe et commercialise sous sa marque",
    "AIA",
    "Art. 3(3)",
    { ownBrand: true, interactsWithPersons: true },
    limited,
  ),
];
