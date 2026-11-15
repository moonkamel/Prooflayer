// PL-609 — Revérification complète de la chaîne de scellement d'une base (toutes les organisations et toutes les
// ancres), en JSON sur la sortie standard : décomptes et anomalies par type (jamais de contenu). Sert à l'exercice de
// restauration (même résultat avant et après) et au diagnostic d'incident.
//   DATABASE_URL=<base> pnpm chain:verify
import { prisma, withOrgTransaction } from "@/server/db";
import { verifyOrgChain } from "@/server/services/chain-verification";
import { verifyAnchors } from "@/server/system/chain-verification";

const byKind = (issues: readonly { kind: string }[]) =>
  issues.reduce<Record<string, number>>(
    (acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }),
    {},
  );

const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
let leaves = 0;
let batches = 0;
const orgIssues: { kind: string }[] = [];
for (const { id } of orgs) {
  const r = await withOrgTransaction(id, (tx) => verifyOrgChain(tx, id));
  leaves += r.leaves;
  batches += r.batches;
  orgIssues.push(...(r.issues as { kind: string }[]));
}
const anchors = await prisma.$transaction((tx) => verifyAnchors(tx), { timeout: 300_000 });
console.log(
  JSON.stringify({
    organizations: orgs.length,
    leaves,
    batches,
    anchors: anchors.anchors,
    orgIssues: byKind(orgIssues),
    anchorIssues: byKind(anchors.issues as { kind: string }[]),
  }),
);
await prisma.$disconnect();
