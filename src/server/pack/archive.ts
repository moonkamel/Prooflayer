// Archive du pack (PL-504) : ZIP (fflate, sans dépendance, lisible aussi dans le navigateur pour PL-508). Dates des
// entrées fixées à la génération du pack ; le manifeste signé en premier.
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { ManifestSignature } from "./signing";

export function zipPack(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: Record<string, unknown> & { signature: ManifestSignature },
  generatedAt: Date,
): Uint8Array {
  const entries: Zippable = {
    "manifest.json": [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { mtime: generatedAt }],
  };
  for (const [path, bytes] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Le PDF et les jetons sont déjà compacts ; le reste se compresse bien.
    const level = path.endsWith(".pdf") || path.endsWith(".tst") ? 0 : 6;
    entries[path] = [bytes, { mtime: generatedAt, level }];
  }
  return zipSync(entries);
}

/** Contenu d'une archive, par chemin. */
export function unzipPack(zip: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(zip)));
}
