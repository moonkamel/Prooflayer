// PL-608 — Rapport de l'entonnoir pour le fondateur (§1.4) : par organisation, étapes atteintes, délai inscription →
// première preuve, part des contrôles évalués automatiquement ; puis médianes et seuils. Sous le rôle applicatif
// (DATABASE_URL), lecture organisation par organisation (RLS). Option --json pour une sortie machine.
import { syncAllFunnels } from "@/server/system/funnel";
import { prisma } from "@/server/db";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const min = (v: number | null) => (v === null ? "—" : `${Math.round(v)} min`);

const { rows, summary } = await syncAllFunnels();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, summary }, null, 2));
} else {
  console.table(
    rows.map(({ name, funnel }) => ({
      organisation: name,
      classification: funnel.steps.classification_signed ? "oui" : "",
      connecteur: funnel.steps.connector_linked ? "oui" : "",
      "première preuve": funnel.steps.first_evidence ? "oui" : "",
      pack: funnel.steps.first_pack ? "oui" : "",
      "délai → preuve": min(funnel.firstEvidenceMinutes),
      "évalués automatiquement": `${pct(funnel.automated.share)} (${funnel.automated.evaluated}/${funnel.automated.applicable})`,
    })),
  );
  console.log(`Organisations : ${summary.organizations}`);
  console.log(`Étapes atteintes : ${JSON.stringify(summary.reached)}`);
  console.log(
    `Délai médian inscription → première preuve : ${min(summary.medianFirstEvidenceMinutes)} (seuil < 15 min : ${summary.thresholds.firstEvidence ?? "—"})`,
  );
  console.log(
    `Part médiane évaluée automatiquement : ${pct(summary.medianAutomatedShare)} (seuil ≥ 40 % : ${summary.thresholds.automatedShare ?? "—"})`,
  );
}
await prisma.$disconnect();
