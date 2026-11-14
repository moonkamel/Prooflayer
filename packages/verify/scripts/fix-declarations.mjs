// Après `tsc` : `rewriteRelativeImportExtensions` réécrit les imports relatifs `.ts` en `.js` dans le JavaScript émis,
// pas dans les déclarations (.d.ts). On les aligne ici, pour les projets qui consomment le paquet.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = new URL("../dist/", import.meta.url).pathname;
for (const name of await readdir(dir)) {
  if (!name.endsWith(".d.ts")) continue;
  const path = join(dir, name);
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(/(from\s+"\.\/[\w-]+)\.ts"/gu, '$1.js"'));
}
