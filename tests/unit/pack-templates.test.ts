// PL-506 — Gabarits Annexe IV et Annexe V : 9 rubriques et 8 mentions, préremplies depuis le registre, rubriques non
// remplies signalées, jamais une rubrique déclarée complète, jamais le mot « conforme » écrit par ProofLayer, et
// mention de l'Annexe V point 4 laissée au fournisseur.
import { describe, expect, it } from "vitest";
import type { PackControl } from "@/server/pack/contents";
import { buildPackFiles } from "@/server/pack/contents";
import { templateLabels } from "@/server/pack/template-labels";
import { ANNEX_IV_CONTROLS, buildTemplates, type TemplateInput } from "@/server/pack/templates";

const control = (key: string, status: string, notApplicable = false): PackControl => ({
  key,
  articleRef: "Art. 9",
  title: { fr: `Titre ${key}`, en: `Title ${key}` },
  automation: "AUTOMATED",
  status,
  notApplicable,
  justification: null,
  evidenceIds: [],
  lastEvaluation: null,
});

const input = (extra: Partial<TemplateInput["system"]> = {}): TemplateInput => ({
  locale: "fr",
  generatedAt: new Date("2027-03-03T10:00:00Z"),
  organization: { name: "Talvio" },
  system: {
    id: "sys_1",
    name: "Score\nde tri",
    intendedPurpose: "Trier les candidatures",
    description: null,
    role: "PROVIDER",
    status: "PRODUCTION",
    placedOnMarketAt: new Date("2026-09-01T00:00:00Z"),
    vendorName: null,
    models: [{ name: "Claude", provider: "Anthropic", version: "5", isGpai: true }],
    dataCategories: ["CV", "lettres de motivation"],
    owner: "Alice Martin",
    oversightOwner: null,
    ...extra,
  },
  classification: {
    signedAt: new Date("2026-11-20T00:00:00Z"),
    tier: "HIGH_RISK",
    annexIIIPoints: ["4(a)"],
  },
  designChanges: [
    {
      occurredAt: new Date("2026-12-01T00:00:00Z"),
      summary: "Nouveau modèle",
      isSignificant: true,
    },
  ],
  controls: [
    control("AIA-09-01", "FAIL"),
    control("AIA-47-01", "MISSING"),
    control("AIA-72-01", "PASS", true),
  ],
});

describe("gabarit Annexe IV", () => {
  it("9 rubriques, préremplies depuis le registre ou signalées à rédiger, aucune complète", async () => {
    const out = buildTemplates(input(), await templateLabels("fr"));
    expect(out.annexIv.sections.map((s) => `${s.number}:${s.state}`)).toEqual([
      "1:PARTIAL",
      "2:PARTIAL",
      "3:PARTIAL",
      "4:EMPTY",
      "5:EMPTY",
      "6:PARTIAL",
      "7:EMPTY",
      "8:PARTIAL",
      "9:EMPTY",
    ]);
    expect(out.counts).toEqual({ annexIvEmpty: 4, annexIvPartial: 5, annexVToWrite: 6 });
    const md = out.annexIv.markdown;
    for (let n = 1; n <= 9; n++) expect(md).toContain(`(Annexe IV, point ${n})`);
    // Valeur saisie ramenée à une ligne ; registre, classification, modèle, changement qualifié.
    expect(md).toContain("# Documentation technique — Score de tri");
    expect(md).toContain("- Finalité prévue (Art. 3(12)) : Trier les candidatures");
    expect(md).toContain("- Fournisseur : Talvio");
    expect(md).toContain("points de l'Annexe III : 4(a)");
    expect(md).toContain("- Modèle : Claude (Anthropic 5), modèle d'IA à usage général");
    expect(md).toContain("- 1 décembre 2026 · Nouveau modèle · modification importante");
    // Contrôles suivis : statut, ou non applicable.
    expect(md).toContain("- AIA-09-01 · Titre AIA-09-01 : En échec");
    expect(md).toContain("- AIA-72-01 · Titre AIA-72-01 : non applicable à ce système");
    expect(md).toContain("4 rubriques à rédiger entièrement, 5 préremplies à compléter, sur 9.");
    expect(md.match(/⚠ Rien dans le registre/gu)).toHaveLength(4);
    expect(md).toContain("- [ ] Notice d'utilisation destinée au déployeur (Art. 13).");
    expect(md).toContain("Aucune rubrique n'est validée automatiquement.");
  });

  it("contrôles rattachés : tous déclarés dans la bibliothèque", async () => {
    const { CONTROL_LIBRARY } = await import("@/server/rules/library");
    const keys = new Set(CONTROL_LIBRARY.map((c) => c.key));
    for (const list of Object.values(ANNEX_IV_CONTROLS))
      for (const k of list) expect(keys).toContain(k);
  });

  it("en anglais", async () => {
    const out = buildTemplates({ ...input(), locale: "en" }, await templateLabels("en"));
    expect(out.annexIv.markdown).toContain("(Annex IV, point 9)");
    expect(out.annexIv.markdown).toContain(
      "4 sections to write from scratch, 5 prefilled, to complete, out of 9.",
    );
    expect(out.annexV.markdown).toContain("6 items out of 8 remain to be written.");
  });
});

describe("gabarit Annexe V", () => {
  it("8 mentions ; point 4 laissé au fournisseur ; jamais « conforme »", async () => {
    const out = buildTemplates(input(), await templateLabels("fr"));
    const md = out.annexV.markdown;
    for (let n = 1; n <= 8; n++) expect(md).toContain(`(Annexe V, point ${n})`);
    expect(out.annexV.items.map((i) => `${i.number}:${i.state}`)).toEqual([
      "1:FILLED",
      "2:PARTIAL",
      "3:FILLED",
      "4:EMPTY",
      "5:EMPTY",
      "6:EMPTY",
      "7:EMPTY",
      "8:EMPTY",
    ]);
    expect(md).toContain(
      "La présente déclaration est établie sous la seule responsabilité de Talvio.",
    );
    expect(md).toContain(
      "Catégories de données déclarées au registre : CV, lettres de motivation.",
    );
    const point4 = md.slice(md.indexOf("(Annexe V, point 4)"), md.indexOf("(Annexe V, point 5)"));
    expect(point4).toContain("⚠ À rédiger par le fournisseur.");
    for (const text of [md, out.annexIv.markdown]) {
      expect(text.toLowerCase()).not.toMatch(/\bconforme\b|\bcompliant\b/u);
    }
  });

  it("déployeur : la déclaration incombe au fournisseur tiers", async () => {
    const out = buildTemplates(
      input({ role: "DEPLOYER", vendorName: "Éditeur SA" }),
      await templateLabels("fr"),
    );
    expect(out.annexV.markdown).toContain(
      "la déclaration UE incombe au fournisseur du système (Éditeur SA)",
    );
    expect(out.annexIv.markdown).toContain("- Fournisseur : Éditeur SA");
  });
});

describe("dans le pack", () => {
  it("les deux gabarits sont des fichiers du pack, listés et empreintés au manifeste", async () => {
    const out = buildTemplates(input(), await templateLabels("fr"));
    const { files, manifest } = buildPackFiles({
      packId: "pck_1",
      generatedAt: new Date(),
      language: "fr",
      organization: { id: "org_1", name: "Talvio" },
      system: { id: "sys_1", name: "Score" },
      period: { start: "2026-12-04", end: "2027-03-03" },
      libraryVersion: "2026.11.0",
      controls: [],
      evidence: [],
      batches: [],
      anchors: [],
      tsaRoots: {},
      report: new Uint8Array([1]),
      verifyMd: "#",
      templates: { annexIv: out.annexIv.markdown, annexV: out.annexV.markdown },
    });
    expect(files.has("templates/annex-iv.md")).toBe(true);
    expect(manifest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["templates/annex-iv.md", "templates/eu-declaration.md"]),
    );
  });
});
