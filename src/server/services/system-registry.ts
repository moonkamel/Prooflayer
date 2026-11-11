// Registre des systèmes d'IA (PL-201, §3.2 E2) : fonctions pures, sans accès à la base.
// Historisation (qui, quand, avant, après), champs utilisés par la classification, slug, export CSV et JSON.
import type { AiActRole, RiskTier, SystemStatus } from "@/generated/prisma/enums";
import { toCsv } from "./csv";

export const AI_ACT_ROLES = [
  "PROVIDER",
  "DEPLOYER",
  "IMPORTER",
  "DISTRIBUTOR",
] as const satisfies readonly AiActRole[];
export const SYSTEM_STATUSES = [
  "DESIGN",
  "DEVELOPMENT",
  "PRODUCTION",
  "RETIRED",
] as const satisfies readonly SystemStatus[];

/** Modèle sous-jacent (§4.3.2, AiSystem.models) : nom, fournisseur, version, modèle d'IA à usage général. */
export interface SystemModel {
  name: string;
  provider: string;
  version: string;
  isGpai: boolean;
}

/** Champs de la fiche modifiables par l'utilisateur (§3.2 E2). Catégorie et points de l'Annexe III viennent de la classification. */
export interface SystemFields {
  name: string;
  intendedPurpose: string;
  description: string | null;
  role: AiActRole;
  status: SystemStatus;
  placedOnMarketAt: Date | null;
  ownerUserId: string;
  oversightOwnerUserId: string | null;
  vendorName: string | null;
  models: SystemModel[];
  dataCategories: string[];
}
export type SystemField = keyof SystemFields;
export type SystemPatch = Partial<SystemFields>;

export const SYSTEM_FIELDS = [
  "name",
  "intendedPurpose",
  "description",
  "role",
  "status",
  "placedOnMarketAt",
  "ownerUserId",
  "oversightOwnerUserId",
  "vendorName",
  "models",
  "dataCategories",
] as const satisfies readonly SystemField[];

/**
 * Champs dont dépend la classification (§3.2 E1 et E2) : leur modification marque la classification « à revoir ».
 * - finalité prévue : cas d'usage de l'Annexe III, Art. 6(3), et changement de finalité de l'Art. 25(1)(c) ;
 * - rôle et fournisseur tiers : détermination du rôle, marque propre de l'Art. 25(1)(a) ;
 * - modèles : modèle d'IA à usage général intégré, modification substantielle de l'Art. 25(1)(b) ;
 * - catégories de données : profilage et données biométriques (Art. 6(3) dernier alinéa, Annexe III point 1).
 * Le nom, la description, le cycle de vie et les responsables n'entrent pas dans l'arbre de décision.
 */
export const CLASSIFICATION_FIELDS = [
  "intendedPurpose",
  "role",
  "vendorName",
  "models",
  "dataCategories",
] as const satisfies readonly SystemField[];

/** Valeur d'un champ telle qu'inscrite à l'historique : JSON stable, dates en ISO 8601. */
export type HistoryValue = string | boolean | null | string[] | SystemModel[];

export interface FieldChange {
  field: SystemField;
  before: HistoryValue;
  after: HistoryValue;
}

function historyValue(field: SystemField, value: SystemFields[SystemField]): HistoryValue {
  if (value instanceof Date) return value.toISOString();
  if (field === "models") {
    return (value as SystemModel[]).map((m) => ({
      name: m.name,
      provider: m.provider,
      version: m.version,
      isGpai: m.isGpai,
    }));
  }
  return value as HistoryValue;
}

/** Modifications réelles apportées par `patch` à la fiche `current` (un champ inchangé n'est pas historisé). */
export function diffSystem(current: SystemFields, patch: SystemPatch): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of SYSTEM_FIELDS) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const before = historyValue(field, current[field]);
    const after = historyValue(field, patch[field] as SystemFields[SystemField]);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
  }
  return changes;
}

export function touchesClassification(changes: readonly FieldChange[]): boolean {
  return changes.some((c) => (CLASSIFICATION_FIELDS as readonly string[]).includes(c.field));
}

/** Lecture prudente de AiSystem.models (colonne JSON) : les entrées mal formées sont ignorées. */
export function parseModels(value: unknown): SystemModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    if (typeof r.name !== "string") return [];
    return [
      {
        name: r.name,
        provider: typeof r.provider === "string" ? r.provider : "",
        version: typeof r.version === "string" ? r.version : "",
        isGpai: r.isGpai === true,
      },
    ];
  });
}

/** Catégories de données : sans doublon (casse comprise) ni entrée vide, dans l'ordre de saisie. */
export function normalizeCategories(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase("fr");
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

/** Identifiant lisible d'un système, unique dans l'organisation (§4.3.2 : @@unique([orgId, slug])). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/u, "");
  return slug || "systeme";
}

/** Premier slug libre : `base`, puis `base-2`, `base-3`… */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Ligne du registre exportée (CSV et JSON). Les responsables sont présentés par « nom <adresse> ». */
export interface RegistryRow {
  id: string;
  slug: string;
  name: string;
  intendedPurpose: string;
  description: string | null;
  role: AiActRole;
  status: SystemStatus;
  riskTier: RiskTier;
  annexIIIPoints: string[];
  classificationStale: boolean;
  placedOnMarketAt: Date | null;
  owner: string;
  oversightOwner: string | null;
  vendorName: string | null;
  models: SystemModel[];
  dataCategories: string[];
  monitored: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function registryToJson(rows: readonly RegistryRow[], exportedAt: Date): string {
  return (
    JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        systems: rows.map((r) => ({
          ...r,
          placedOnMarketAt: iso(r.placedOnMarketAt),
          createdAt: iso(r.createdAt),
          updatedAt: iso(r.updatedAt),
          archivedAt: iso(r.archivedAt),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

export function registryToCsv(rows: readonly RegistryRow[]): string {
  return toCsv(
    [
      "id",
      "slug",
      "name",
      "intended_purpose",
      "description",
      "role",
      "status",
      "risk_tier",
      "annex_iii_points",
      "classification_stale",
      "placed_on_market_at",
      "owner",
      "oversight_owner",
      "vendor_name",
      "models",
      "data_categories",
      "monitored",
      "created_at",
      "updated_at",
      "archived_at",
    ],
    rows.map((r) => [
      r.id,
      r.slug,
      r.name,
      r.intendedPurpose,
      r.description,
      r.role,
      r.status,
      r.riskTier,
      r.annexIIIPoints.join(" | "),
      r.classificationStale,
      iso(r.placedOnMarketAt),
      r.owner,
      r.oversightOwner,
      r.vendorName,
      r.models
        .map(
          (m) =>
            `${[m.name, m.version].filter(Boolean).join(" ")} (${[m.provider, m.isGpai ? "GPAI" : ""].filter(Boolean).join(", ")})`,
        )
        .join(" | "),
      r.dataCategories.join(" | "),
      r.monitored,
      iso(r.createdAt),
      iso(r.updatedAt),
      iso(r.archivedAt),
    ]),
  );
}
