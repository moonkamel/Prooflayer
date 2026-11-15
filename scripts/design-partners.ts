// PL-610 — Suivi des design partners (§7.5) et relevé des quatre métriques du §1.4. Sous le rôle applicatif
// (DATABASE_URL). Identifiant d'organisation : visible dans le journal d'audit ou la base, jamais dans le dépôt.
//
//   pnpm partners add <orgId> <hr_tech|fintech|exemption>   ouvre le pilote (12 semaines, limites Growth)
//   pnpm partners session <orgId>                          session de mise en route d'une heure tenue et enregistrée
//   pnpm partners shared <orgId> <client|investor|auditor> pack transmis à un tiers réel (déclaré par le partenaire)
//   pnpm partners replace <orgId>                          partenaire remplacé (règle du §7.5)
//   pnpm partners report [--json]                          relevé par partenaire et synthèse de la cohorte
import { prisma } from "@/server/db";
import {
  PACK_AUDIENCES,
  SEGMENTS,
  type PackAudience,
  type Segment,
} from "@/server/services/design-partners-data";
import {
  addPartner,
  markReplaced,
  partnersReport,
  recordPackShared,
  recordSession,
} from "@/server/system/design-partners";

const [command, orgId, arg] = process.argv.slice(2);
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const min = (v: number | null) => (v === null ? "—" : `${Math.round(v)} min`);
const yes = (v: boolean | null) => (v === null ? "—" : v ? "oui" : "non");

function need<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T {
  if (!value || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label} attendu : ${allowed.join(", ")}`);
  }
  return value as T;
}

try {
  if (command === "add") {
    if (!orgId) throw new Error("orgId attendu");
    console.log(await addPartner(orgId, need<Segment>(arg, SEGMENTS, "segment")));
  } else if (command === "session") {
    if (!orgId) throw new Error("orgId attendu");
    await recordSession(orgId);
    console.log("Session enregistrée.");
  } else if (command === "shared") {
    if (!orgId) throw new Error("orgId attendu");
    await recordPackShared(orgId, need<PackAudience>(arg, PACK_AUDIENCES, "destinataire"));
    console.log("Transmission enregistrée.");
  } else if (command === "replace") {
    if (!orgId) throw new Error("orgId attendu");
    await markReplaced(orgId);
    console.log("Partenaire marqué remplacé.");
  } else if (command === "report") {
    const report = await partnersReport();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.table(
        report.partners.map((p) => ({
          partenaire: p.name,
          segment: p.segment,
          session: p.sessionDone ? "faite" : "",
          "délai → preuve": min(p.metrics.firstEvidenceMinutes),
          "évalués automatiquement": pct(p.metrics.automatedShare),
          "pack transmis": p.metrics.packShared ?? "",
          payant: p.metrics.paying ? "oui" : "",
          statut: p.replaced ? "remplacé" : p.replaceDue ? "À REMPLACER (GitHub non connecté)" : "",
        })),
      );
      const c = report.cohort;
      console.log(
        `Partenaires actifs : ${c.active} ; sessions faites : ${c.sessionsDone} ; segments : ${JSON.stringify(c.segments)}`,
      );
      console.log(
        `1. Délai médian inscription → première preuve : ${min(c.medianFirstEvidenceMinutes)} (< 15 min : ${yes(c.thresholds.firstEvidence)})`,
      );
      console.log(
        `2. Part médiane évaluée automatiquement : ${pct(c.medianAutomatedShare)} (≥ 40 % : ${yes(c.thresholds.automatedShare)})`,
      );
      console.log(
        `3. Pack transmis à un tiers réel : ${c.packShared}/${c.active} (≥ 3 sur 5 : ${yes(c.thresholds.packShared)})`,
      );
      console.log(
        `4. Convertis en payant : ${c.paying}/${c.active} (≥ 3 sur 5 : ${yes(c.thresholds.paying)})`,
      );
    }
  } else {
    throw new Error(
      "Commande : add | session | shared | replace | report (voir l'en-tête du script).",
    );
  }
} finally {
  await prisma.$disconnect();
}
