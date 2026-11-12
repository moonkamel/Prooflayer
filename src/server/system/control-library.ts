// Publication de la bibliothèque de contrôles dans `ControlDefinition` (PL-206, §3.2 E6). Table système, commune à
// toutes les organisations : écrite sous le rôle de migration par `pnpm controls:sync`, lue par le rôle applicatif.
// Idempotent : rejouer la commande ne crée ni ne modifie rien. Un contrôle retiré d'une version est marqué
// `deprecatedAt`, jamais supprimé (ses instances et leur historique restent).
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { CONTROL_LIBRARY, LIBRARY_VERSION, type Control } from "@/server/rules/library";

type Client = Pick<PrismaClient, "controlDefinition">;

const dataOf = (c: Control) => ({
  articleRef: c.articleRef,
  pack: c.pack,
  title: c.title,
  statement: c.statement,
  appliesToRoles: [...c.appliesToRoles],
  appliesToTiers: [...c.appliesToTiers],
  automation: c.automation,
  evidenceKinds: [...c.evidenceKinds],
  freshnessDays: c.freshnessDays,
  evaluatorKey: c.evaluatorKey,
  params: c.params as Prisma.InputJsonObject,
});

/** Comparaison indépendante de l'ordre des clés (Postgres ne garde pas l'ordre des objets jsonb). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface SyncReport {
  libraryVersion: string;
  created: string[];
  /** Contrôles dont le contenu a changé dans une version déjà publiée : à signaler (§3.2 E6). */
  updated: string[];
  deprecated: string[];
  unchanged: number;
}

export async function syncControlLibrary(
  client: Client,
  library: readonly Control[] = CONTROL_LIBRARY,
  libraryVersion: string = LIBRARY_VERSION,
  now: Date = new Date(),
): Promise<SyncReport> {
  const existing = await client.controlDefinition.findMany({ where: { libraryVersion } });
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const report: SyncReport = {
    libraryVersion,
    created: [],
    updated: [],
    deprecated: [],
    unchanged: 0,
  };

  for (const control of library) {
    const data = dataOf(control);
    const row = byKey.get(control.key);
    if (!row) {
      await client.controlDefinition.create({
        data: { key: control.key, libraryVersion, ...data },
      });
      report.created.push(control.key);
      continue;
    }
    const current = Object.fromEntries(
      Object.keys(data).map((k) => [k, row[k as keyof typeof row]]),
    );
    if (stable(current) === stable(data) && row.deprecatedAt === null) {
      report.unchanged += 1;
      continue;
    }
    await client.controlDefinition.update({
      where: { id: row.id },
      data: { ...data, deprecatedAt: null },
    });
    report.updated.push(control.key);
  }

  const kept = new Set(library.map((c) => c.key));
  for (const row of existing) {
    if (!kept.has(row.key) && row.deprecatedAt === null) {
      await client.controlDefinition.update({ where: { id: row.id }, data: { deprecatedAt: now } });
      report.deprecated.push(row.key);
    }
  }
  return report;
}
