// PL-608 — Étapes de l'entonnoir d'une organisation, tirées des données elles-mêmes (dates exactes, rien à
// instrumenter dans chaque service, connecteurs futurs compris) : inscription (premier owner), première
// classification signée, premier connecteur lié, première preuve capturée hors `system.*`, premier pack prêt.
// `syncFunnelEvents` inscrit les étapes nouvellement atteintes dans `FunnelEvent` (une fois chacune).
import { randomUUID } from "node:crypto";
import type { OrgTransaction } from "@/server/db";
import { earliestOwnerSignup } from "@/server/system/identity";
import { orgFunnel, type FunnelEventName } from "./funnel-data";

export async function funnelFacts(tx: OrgTransaction, orgId: string) {
  const [signup, signed, integration, evidence, pack, instances] = await Promise.all([
    earliestOwnerSignup(orgId),
    tx.classification.findFirst({
      where: { orgId, signedAt: { not: null } },
      orderBy: { signedAt: "asc" },
      select: { signedAt: true },
    }),
    tx.integration.findFirst({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    tx.evidenceItem.findFirst({
      where: { orgId, NOT: { kind: { startsWith: "system." } } },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true },
    }),
    tx.auditPack.findFirst({
      where: { orgId, status: "READY" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    tx.controlInstance.findMany({
      where: { orgId, system: { archivedAt: null, monitored: true } },
      select: { notApplicable: true, status: true, definition: { select: { evaluatorKey: true } } },
    }),
  ]);
  const dates: [FunnelEventName, Date | null | undefined][] = [
    ["signup", signup],
    ["classification_signed", signed?.signedAt],
    ["connector_linked", integration?.createdAt],
    ["first_evidence", evidence?.capturedAt],
    ["first_pack", pack?.createdAt],
  ];
  return {
    events: dates.flatMap(([name, occurredAt]) => (occurredAt ? [{ name, occurredAt }] : [])),
    instances: instances.map((i) => ({
      notApplicable: i.notApplicable,
      status: i.status,
      evaluatorKey: i.definition.evaluatorKey,
    })),
  };
}

/** Inscrit les étapes atteintes non encore enregistrées ; renvoie les identifiants créés. */
export async function syncFunnelEvents(tx: OrgTransaction, orgId: string) {
  const facts = await funnelFacts(tx, orgId);
  const known = new Set(
    (await tx.funnelEvent.findMany({ where: { orgId }, select: { name: true } })).map(
      (e) => e.name,
    ),
  );
  const created: string[] = [];
  for (const e of facts.events) {
    if (known.has(e.name)) continue;
    const id = randomUUID();
    const { count } = await tx.funnelEvent.createMany({
      data: [{ id, orgId, name: e.name, occurredAt: e.occurredAt }],
      skipDuplicates: true,
    });
    if (count) created.push(id);
  }
  return { created, funnel: orgFunnel(facts.events, facts.instances) };
}
