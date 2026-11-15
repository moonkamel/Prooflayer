// PL-609 — Exercice de restauration complète, chronométré (§4.7 : « restauration testée avant le premier client
// payant, puis chaque trimestre ; §8.3 : sur un environnement vierge, chronométrée »).
//
// 1. Sauvegarde logique de la base source (pg_dump, format personnalisé).
// 2. Restauration sur une base cible VIDE (rôle applicatif recréé sans mot de passe s'il manque).
// 3. Contrôles : même nombre de lignes par table ; chaîne de scellement de chaque organisation et jetons d'horodatage
//    revérifiés hors ligne (`pnpm chain:verify`), avec exactement le même résultat que sur la source.
// 4. Rapport : durée de chaque étape et durée totale (objectif de restauration à consigner dans le runbook).
//
//   RESTORE_SOURCE_URL=<source> RESTORE_TARGET_URL=<cible vide> RESTORE_CONFIRM=jetable pnpm restore:drill
//
// La source n'est que lue. La cible doit être une base vierge : le script refuse une cible qui contient des tables.
// Le stockage objet (Supabase Storage) n'est pas couvert : voir docs/operations/runbook.md.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const source = process.env.RESTORE_SOURCE_URL ?? process.env.DIRECT_DATABASE_URL;
const target = process.env.RESTORE_TARGET_URL;
if (!source || !target)
  throw new Error("RESTORE_SOURCE_URL (ou DIRECT_DATABASE_URL) et RESTORE_TARGET_URL requis.");
if (process.env.RESTORE_CONFIRM !== "jetable") {
  throw new Error(
    "Refus : définir RESTORE_CONFIRM=jetable pour confirmer que la cible est une base vierge.",
  );
}
if (source === target) throw new Error("Refus : la cible est la source.");

const timings: Record<string, number> = {};
async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  timings[name] = Math.round(performance.now() - start);
  console.log(`✔ ${name} (${(timings[name]! / 1000).toFixed(1)} s)`);
  return result;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const tablesOf = (c: pg.Client) =>
  c
    .query<{ table: string }>(
      `SELECT tablename AS table FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    .then((r) => r.rows.map((x) => x.table));

async function rowCounts(url: string) {
  return withClient(url, async (c) => {
    const counts: Record<string, number> = {};
    // Rôle de migration : la RLS forcée ne s'applique pas aux super-utilisateurs ; sinon on lit sous BYPASSRLS.
    for (const table of await tablesOf(c)) {
      const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
      counts[table] = rows[0]!.n;
    }
    return counts;
  });
}

const dir = mkdtempSync(join(tmpdir(), "pl-restore-"));
const dump = join(dir, "prooflayer.dump");
const started = performance.now();
try {
  await step("cible vierge", () =>
    withClient(target, async (c) => {
      const tables = await tablesOf(c);
      if (tables.length) throw new Error(`Refus : la cible contient ${tables.length} tables.`);
      await c.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prooflayer_app')
           THEN CREATE ROLE prooflayer_app NOLOGIN; END IF; END $$`,
      );
    }),
  );
  await step("sauvegarde (pg_dump)", () =>
    execFileSync("pg_dump", ["--format=custom", "--no-owner", `--file=${dump}`, source], {
      stdio: "inherit",
    }),
  );
  console.log(`  taille de la sauvegarde : ${(statSync(dump).size / 1024 / 1024).toFixed(1)} Mo`);
  await step("restauration (pg_restore)", () =>
    execFileSync(
      "pg_restore",
      ["--no-owner", "--exit-on-error", "--single-transaction", `--dbname=${target}`, dump],
      { stdio: "inherit" },
    ),
  );
  const [before, after] = await step("décomptes par table", () =>
    Promise.all([rowCounts(source), rowCounts(target)]),
  );
  const diff = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
  if (diff.length) throw new Error(`Décomptes différents : ${diff.join(", ")}`);
  console.log(
    `  ${Object.keys(after).length} tables, ${Object.values(after).reduce((a, b) => a + b, 0)} lignes`,
  );

  // Chaîne de scellement revérifiée sur la source puis sur la cible (processus séparés, un client par base) : une
  // restauration fidèle donne exactement le même résultat. En production, ce résultat doit être sans anomalie.
  const verify = (url: string) =>
    JSON.parse(
      execFileSync("pnpm", ["-s", "chain:verify"], {
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .at(-1)!,
    ) as { orgIssues: Record<string, number>; anchorIssues: Record<string, number> };
  const reference = await step("chaîne vérifiée sur la source", () => verify(source));
  const result = await step("chaîne revérifiée sur la cible", () => verify(target));
  console.log(`  ${JSON.stringify(result)}`);
  if (JSON.stringify(result) !== JSON.stringify(reference)) {
    throw new Error("La chaîne restaurée diffère de la source.");
  }
  const anomalies =
    Object.values(result.orgIssues).reduce((a, b) => a + b, 0) +
    Object.values(result.anchorIssues).reduce((a, b) => a + b, 0);
  if (anomalies)
    console.log(`  ⚠ ${anomalies} anomalies, identiques sur la source (données de test ?)`);
  timings.total = Math.round(performance.now() - started);
  console.log(JSON.stringify({ restoreDrill: "ok", timingsMs: timings, chain: result }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
