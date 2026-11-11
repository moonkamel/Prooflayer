// PL-102 — Vérification de bout en bout des migrations sur une base jetable (CI, poste local).
//
// 1. Applique les migrations ; vérifie l'absence d'écart entre la base et prisma/schema.prisma.
// 2. Vérifie le rôle applicatif : pas de BYPASSRLS, pas propriétaire des tables, pas de suppression en ajout seul.
// 3. Charge deux fois les données de démonstration : aucun doublon.
// 4. Exécute les retours arrière, de la migration la plus récente à la plus ancienne : la base redevient vide.
// 5. Réapplique les migrations : la migration est réversible et rejouable.
//
// Utilise DIRECT_DATABASE_URL (rôle de migration). Destructif : à ne lancer que sur une base jetable.
//   pnpm db:check
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("DIRECT_DATABASE_URL manquant.");
if (process.env.DB_CHECK_CONFIRM !== "jetable") {
  throw new Error(
    "Refus : définir DB_CHECK_CONFIRM=jetable pour confirmer que la base est jetable.",
  );
}

const APP_ROLE = "prooflayer_app";
const MIGRATIONS_DIR = "prisma/migrations";
// Une table par modèle du schéma : le décompte suit le schéma au lieu d'être figé.
const EXPECTED_TABLES = (readFileSync("prisma/schema.prisma", "utf8").match(/^model /gm) ?? [])
  .length;

const run = (cmd: string, args: string[]): void => {
  execFileSync(cmd, args, { stdio: "inherit", env: process.env });
};
const prisma = (...args: string[]): void => run("pnpm", ["exec", "prisma", ...args]);

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`Échec : ${message}`);
  console.log(`✔ ${message}`);
};

async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function publicTables(): Promise<string[]> {
  const rows = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  return rows.map((r) => r.tablename);
}

async function deployAndVerify(): Promise<void> {
  prisma("migrate", "deploy");
  // --exit-code : 0 si la base correspond au schéma, 2 si un écart existe.
  prisma(
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--exit-code",
  );
  check(true, "aucun écart entre la base et prisma/schema.prisma");
  check(
    (await publicTables()).length === EXPECTED_TABLES,
    `${EXPECTED_TABLES} tables créées, une par modèle du schéma`,
  );
}

async function verifyAppRole(): Promise<void> {
  const [role] = await query<{ rolbypassrls: boolean; rolsuper: boolean; rolcanlogin: boolean }>(
    `SELECT rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = $1`,
    [APP_ROLE],
  );
  check(role !== undefined, `rôle ${APP_ROLE} présent`);
  check(role?.rolbypassrls === false, `${APP_ROLE} sans BYPASSRLS`);
  check(role?.rolsuper === false, `${APP_ROLE} non superutilisateur`);

  const owned = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`,
    [APP_ROLE],
  );
  check(owned.length === 0, `${APP_ROLE} n'est propriétaire d'aucune table`);

  const privilege = async (table: string, priv: string): Promise<boolean> => {
    const [row] = await query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
      APP_ROLE,
      `public."${table}"`,
      priv,
    ]);
    return row?.ok === true;
  };
  check(await privilege("AiSystem", "SELECT"), `${APP_ROLE} lit les tables métier`);
  // Tables créées après la migration du rôle : droits reçus par les privilèges par défaut.
  check(
    (await privilege("TwoFactor", "INSERT")) && (await privilege("Verification", "DELETE")),
    `${APP_ROLE} a ses droits sur les tables créées après lui (TwoFactor, Verification)`,
  );
  check(await privilege("EvidenceItem", "INSERT"), `${APP_ROLE} insère dans EvidenceItem`);
  check(
    !(await privilege("EvidenceItem", "DELETE")),
    `${APP_ROLE} ne supprime pas dans EvidenceItem`,
  );
  check(!(await privilege("AuditLog", "UPDATE")), `${APP_ROLE} ne modifie pas AuditLog`);
  check(!(await privilege("AuditLog", "DELETE")), `${APP_ROLE} ne supprime pas dans AuditLog`);
}

async function seedTwice(): Promise<void> {
  run("pnpm", ["db:seed"]);
  run("pnpm", ["db:seed"]);
  const [counts] = await query<{ orgs: number; systems: number; members: number }>(
    `SELECT (SELECT count(*)::int FROM "Organization") AS orgs,
            (SELECT count(*)::int FROM "AiSystem") AS systems,
            (SELECT count(*)::int FROM "Member") AS members`,
  );
  check(
    counts?.orgs === 1 && counts.systems === 2 && counts.members === 1,
    "données de démonstration idempotentes : 1 organisation, 2 systèmes, 1 membre",
  );
}

async function rollbackAll(): Promise<void> {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of migrations) {
    const down = join(MIGRATIONS_DIR, name, "down.sql");
    check(existsSync(down), `${name} a son retour arrière`);
    prisma("db", "execute", "--file", down);
  }
  check((await publicTables()).length === 0, "après retour arrière, aucune table métier");
  const roles = await query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [APP_ROLE]);
  check(roles.length === 0, `après retour arrière, ${APP_ROLE} supprimé`);
  const history = await query(`SELECT 1 FROM "_prisma_migrations"`);
  check(history.length === 0, "après retour arrière, historique Prisma vide");
}

async function main(): Promise<void> {
  await deployAndVerify();
  await verifyAppRole();
  await seedTwice();
  await rollbackAll();
  await deployAndVerify();
  await verifyAppRole();
  await seedTwice();
  console.log("Migrations vérifiées : appliquées, réversibles, rejouables.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
