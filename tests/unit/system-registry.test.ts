// PL-201 — Registre : historisation des modifications, champs de classification, slug, exports.
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_FIELDS,
  diffSystem,
  nextFreeSlug,
  normalizeCategories,
  parseModels,
  registryToCsv,
  registryToJson,
  slugify,
  touchesClassification,
  type RegistryRow,
  type SystemFields,
} from "@/server/services/system-registry";

const fiche: SystemFields = {
  name: "Score d'adéquation candidat",
  intendedPurpose: "Classe les candidatures par adéquation au poste",
  description: null,
  role: "PROVIDER",
  status: "PRODUCTION",
  placedOnMarketAt: new Date("2025-03-14T00:00:00.000Z"),
  ownerUserId: "usr_clara",
  oversightOwnerUserId: null,
  vendorName: null,
  models: [{ name: "gradient boosting", provider: "interne", version: "2.14", isGpai: false }],
  dataCategories: ["CV", "offres"],
};

describe("diffSystem", () => {
  it("n'historise que les champs réellement modifiés, avec avant et après", () => {
    expect(
      diffSystem(fiche, {
        name: fiche.name,
        description: "Nouvelle description",
        status: "RETIRED",
      }),
    ).toEqual([
      { field: "description", before: null, after: "Nouvelle description" },
      { field: "status", before: "PRODUCTION", after: "RETIRED" },
    ]);
  });

  it("inscrit les dates en ISO 8601 et compare les dates par valeur", () => {
    expect(diffSystem(fiche, { placedOnMarketAt: new Date("2025-03-14T00:00:00.000Z") })).toEqual(
      [],
    );
    expect(diffSystem(fiche, { placedOnMarketAt: null })).toEqual([
      { field: "placedOnMarketAt", before: "2025-03-14T00:00:00.000Z", after: null },
    ]);
  });

  it("compare modèles et catégories par contenu", () => {
    expect(
      diffSystem(fiche, { models: [...fiche.models], dataCategories: ["CV", "offres"] }),
    ).toEqual([]);
    const models = [
      ...fiche.models,
      { name: "claude-sonnet", provider: "Anthropic", version: "", isGpai: true },
    ];
    const [change] = diffSystem(fiche, { models });
    expect(change).toEqual({ field: "models", before: fiche.models, after: models });
  });

  it("ignore un champ absent ou undefined", () => {
    expect(diffSystem(fiche, { vendorName: undefined })).toEqual([]);
  });
});

describe("champs utilisés par la classification", () => {
  it.each(CLASSIFICATION_FIELDS)("modifier « %s » marque la classification à revoir", (field) => {
    const patch = {
      intendedPurpose: "Planifie les entretiens",
      role: "DEPLOYER",
      vendorName: "Éditeur tiers",
      models: [],
      dataCategories: ["décisions passées"],
    }[field];
    expect(touchesClassification(diffSystem(fiche, { [field]: patch }))).toBe(true);
  });

  it("le nom, la description, le cycle de vie et les responsables ne la touchent pas", () => {
    const changes = diffSystem(fiche, {
      name: "Autre nom",
      description: "x",
      status: "RETIRED",
      placedOnMarketAt: null,
      ownerUserId: "usr_autre",
      oversightOwnerUserId: "usr_sf",
    });
    expect(changes).toHaveLength(6);
    expect(touchesClassification(changes)).toBe(false);
  });
});

describe("parseModels et normalizeCategories", () => {
  it("ignore les entrées mal formées et complète les champs manquants", () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels([{ name: "m" }, 3, null, { provider: "x" }])).toEqual([
      { name: "m", provider: "", version: "", isGpai: false },
    ]);
  });

  it("retire doublons et entrées vides, en gardant l'ordre", () => {
    expect(normalizeCategories([" CV ", "cv", "", "Offres", "offres "])).toEqual(["CV", "Offres"]);
  });
});

describe("slug", () => {
  it("retire accents et ponctuation", () => {
    expect(slugify("Score d'adéquation candidat")).toBe("score-d-adequation-candidat");
    expect(slugify("  ### ")).toBe("systeme");
    expect(slugify("a".repeat(80))).toHaveLength(60);
  });

  it("ajoute un suffixe si le slug est pris", () => {
    expect(nextFreeSlug("x", new Set())).toBe("x");
    expect(nextFreeSlug("x", new Set(["x", "x-2"]))).toBe("x-3");
  });
});

describe("exports", () => {
  const row: RegistryRow = {
    id: "sys_1",
    slug: "score",
    name: "=Score",
    intendedPurpose: fiche.intendedPurpose,
    description: null,
    role: "PROVIDER",
    status: "PRODUCTION",
    riskTier: "HIGH_RISK",
    annexIIIPoints: ["4(a)"],
    classificationStale: true,
    placedOnMarketAt: fiche.placedOnMarketAt,
    owner: "Clara Martin <clara@talvio.test>",
    oversightOwner: null,
    vendorName: null,
    models: [
      { name: "claude-sonnet", provider: "Anthropic", version: "", isGpai: true },
      { name: "gbm", provider: "interne", version: "2.14", isGpai: false },
    ],
    dataCategories: ["CV", "offres"],
    monitored: false,
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    updatedAt: new Date("2026-11-02T10:00:00.000Z"),
    archivedAt: null,
  };

  it("CSV : en-tête, listes jointes, cellules protégées contre les formules", () => {
    const [header, line] = registryToCsv([row]).split("\r\n");
    expect(header?.split(",")).toContain("annex_iii_points");
    expect(line).toContain(`"'=Score"`);
    expect(line).toContain("claude-sonnet (Anthropic, GPAI) | gbm 2.14 (interne)");
    expect(line).toContain("2025-03-14T00:00:00.000Z");
  });

  it("JSON : dates en ISO 8601 et date d'export", () => {
    const parsed = JSON.parse(registryToJson([row], new Date("2026-11-11T00:00:00.000Z")));
    expect(parsed.exportedAt).toBe("2026-11-11T00:00:00.000Z");
    expect(parsed.systems[0]).toMatchObject({
      name: "=Score",
      placedOnMarketAt: "2025-03-14T00:00:00.000Z",
      archivedAt: null,
      models: row.models,
    });
  });
});
