// PL-607 — Export complet d'une organisation (§3.2, §4.7 « export complet en libre-service »), fonctions pures.
// Formats ouverts et lisibles sans ProofLayer : JSON (une valeur binaire = hexadécimal minuscule, une date = ISO 8601
// UTC), pièces jointes et charges brutes en clair, packs d'audit tels quels (vérifiables par @prooflayer/verify).
// manifest.json liste chaque fichier avec son empreinte SHA-256 : une archive tronquée se voit.
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";

export const EXPORT_FORMAT = { name: "prooflayer-org-export", version: 1 } as const;

/** Valeur prête pour JSON : octets en hexadécimal, dates en ISO, objets et tableaux parcourus. */
export function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const json = (value: unknown) => strToU8(`${JSON.stringify(plain(value), null, 2)}\n`);

export interface ExportEvidence {
  row: Record<string, unknown> & { id: string };
  raw: Uint8Array | null;
  attachment: { bytes: Uint8Array; extension: string } | null;
}

export interface ExportInput {
  organization: { id: string; name: string; slug: string };
  exportedAt: Date;
  members: unknown[];
  systems: unknown[];
  designChanges: unknown[];
  classifications: unknown[];
  exemptions: unknown[];
  controls: unknown[];
  evaluations: unknown[];
  comments: unknown[];
  evidenceLinks: unknown[];
  integrations: unknown[];
  sealBatches: unknown[];
  auditLog: unknown[];
  packs: { meta: Record<string, unknown> & { id: string }; zip: Uint8Array | null }[];
  evidence: ExportEvidence[];
}

export type ExportCounts = Record<
  "systems" | "classifications" | "controls" | "evidence" | "attachments" | "packs" | "auditLog",
  number
>;

/** Fichiers de l'archive (hors manifeste), triés ; chemins stables d'un export à l'autre. */
export function exportFiles(input: ExportInput): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set("organization/members.json", json(input.members));
  files.set("organization/integrations.json", json(input.integrations));
  files.set("registry/systems.json", json(input.systems));
  files.set("registry/design-changes.json", json(input.designChanges));
  files.set("classifications/classifications.json", json(input.classifications));
  files.set("classifications/exemption-dossiers.json", json(input.exemptions));
  files.set("controls/instances.json", json(input.controls));
  files.set("controls/evaluations.json", json(input.evaluations));
  files.set("controls/comments.json", json(input.comments));
  files.set("evidence/links.json", json(input.evidenceLinks));
  files.set("seals/batches.json", json(input.sealBatches));
  files.set("audit-log.json", json(input.auditLog));
  for (const e of input.evidence) {
    files.set(`evidence/${e.row.id}.json`, json(e.row));
    if (e.raw) files.set(`evidence/${e.row.id}.raw.json`, e.raw);
    if (e.attachment)
      files.set(`evidence/${e.row.id}.${e.attachment.extension}`, e.attachment.bytes);
  }
  files.set("packs/packs.json", json(input.packs.map((p) => p.meta)));
  for (const p of input.packs) if (p.zip) files.set(`packs/${p.meta.id}.zip`, p.zip);
  return files;
}

export function exportCounts(input: ExportInput): ExportCounts {
  return {
    systems: input.systems.length,
    classifications: input.classifications.length,
    controls: input.controls.length,
    evidence: input.evidence.length,
    attachments: input.evidence.filter((e) => e.attachment).length,
    packs: input.packs.filter((p) => p.zip).length,
    auditLog: input.auditLog.length,
  };
}

export function exportManifest(input: ExportInput, files: ReadonlyMap<string, Uint8Array>) {
  return {
    format: EXPORT_FORMAT.name,
    version: EXPORT_FORMAT.version,
    organization: input.organization,
    exportedAt: input.exportedAt.toISOString(),
    counts: exportCounts(input),
    files: Object.fromEntries(
      [...files.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")]),
    ),
  };
}

/** Archive ZIP : manifeste en tête, puis les fichiers ; packs et pièces déjà compressés stockés tels quels. */
export function zipExport(input: ExportInput): { zip: Uint8Array; counts: ExportCounts } {
  const files = exportFiles(input);
  const manifest = exportManifest(input, files);
  const mtime = input.exportedAt;
  const entries: Zippable = {
    "manifest.json": [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { mtime }],
  };
  for (const [path, bytes] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stored = /\.(zip|pdf|png|jpg|docx)$/u.test(path);
    entries[path] = [bytes, { mtime, level: stored ? 0 : 6 }];
  }
  return { zip: zipSync(entries), counts: manifest.counts };
}
