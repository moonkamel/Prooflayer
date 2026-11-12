// PL-205 — Évaluateur du contrôle AIA-06-02 et champs de l'Annexe VIII section B.
import { describe, expect, it } from "vitest";
import {
  evaluateExemptionDossier,
  type ExemptionFacts,
} from "@/server/rules/evaluators/exemption-dossier";
import {
  EU_MEMBER_STATES,
  annexVIIIB,
  annexVIIIBToCsv,
  annexVIIIBToJson,
  marketStatusOf,
} from "@/server/services/annex-viii";

const now = new Date("2026-11-12T10:00:00Z");
const signed: ExemptionFacts = {
  tier: "HIGH_RISK_EXEMPT_ART6_3",
  classificationId: "cls_1",
  dossier: {
    id: "dos_1",
    signedAt: new Date("2026-06-01T00:00:00Z"),
    conditionJustification: "Extraction de champs sans appréciation.",
    profilingJustification: "Aucun score ni classement de personnes.",
  },
  placedOnMarketAt: new Date("2026-09-01T00:00:00Z"),
};

describe("évaluateur AIA-06-02 (internal.exemptionDossier)", () => {
  it("succès : dossier signé, justifié, avant la mise sur le marché", () => {
    const result = evaluateExemptionDossier(signed, now);
    expect(result.status).toBe("PASS");
    expect(result.evidenceIds).toEqual(["cls_1", "dos_1"]);
    expect(result.reasons[0]?.message.en).toMatch(/Signed exemption file/u);
  });

  it("périmé : seul un dossier signé pour une classification remplacée existe", () => {
    const result = evaluateExemptionDossier(
      { ...signed, dossier: null, previousDossierId: "dos_0" },
      now,
    );
    expect(result).toMatchObject({ status: "STALE" });
    expect(result.reasons[0]!.code).toBe("DOSSIER_FOR_SUPERSEDED_CLASSIFICATION");
    expect(result.evidenceIds).toContain("dos_0");
  });

  it("absent : système exempté sans dossier signé", () => {
    const result = evaluateExemptionDossier({ ...signed, dossier: null }, now);
    expect(result).toMatchObject({ status: "MISSING", evidenceIds: ["cls_1"] });
    expect(result.reasons[0]?.code).toBe("NO_SIGNED_DOSSIER");
  });

  it("échec : justification ou motivation vide", () => {
    for (const blank of ["conditionJustification", "profilingJustification"] as const) {
      const result = evaluateExemptionDossier(
        { ...signed, dossier: { ...signed.dossier!, [blank]: "  " } },
        now,
      );
      expect(result.status, blank).toBe("FAIL");
      expect(result.reasons[0]?.code).toBe("INCOMPLETE_DOSSIER");
    }
  });

  it("partiel : dossier signé après la mise sur le marché (Art. 6(4) : « avant »)", () => {
    const late = { ...signed, placedOnMarketAt: new Date("2026-03-01T00:00:00Z") };
    expect(evaluateExemptionDossier(late, now)).toMatchObject({
      status: "PARTIAL",
      reasons: [{ code: "ASSESSED_AFTER_MARKET" }],
    });
    // Sans date de mise sur le marché déclarée, rien ne contredit l'antériorité.
    expect(evaluateExemptionDossier({ ...signed, placedOnMarketAt: null }, now).status).toBe(
      "PASS",
    );
  });

  it("non applicable : système non exempté, ou sans classification signée", () => {
    for (const tier of ["HIGH_RISK", "MINIMAL", null] as const) {
      expect(evaluateExemptionDossier({ ...signed, tier }, now).status).toBe("NOT_APPLICABLE");
    }
  });
});

describe("Annexe VIII section B", () => {
  const fields = annexVIIIB({
    providerName: "Recrutys SAS",
    providerAddress: "12 rue de la Paix, 75002 Paris",
    providerContact: "conformite@recrutys.example",
    submitter: null,
    representative: null,
    tradeName: "Recrutys ATS",
    systemReference: "sys_123",
    intendedPurpose: "Extrait les champs d'un CV",
    art63Conditions: ["a"],
    conditionJustification: "Tâche procédurale étroite",
    profilingJustification: "Aucun profilage",
    systemStatus: "PRODUCTION",
    memberStates: ["FR", "BE"],
  });

  it("donne les neuf points, dans l'ordre", () => {
    expect(fields.map((f) => f.point)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fields.find((f) => f.point === 6)?.value).toEqual(["6(3)(a)"]);
    expect(fields.find((f) => f.point === 8)?.value).toBe("onMarket");
  });

  it("statut du point 8 déduit du cycle de vie", () => {
    expect(marketStatusOf("DESIGN")).toBe("notYetPlaced");
    expect(marketStatusOf("DEVELOPMENT")).toBe("notYetPlaced");
    expect(marketStatusOf("RETIRED")).toBe("noLongerOnMarket");
  });

  it("exports CSV et JSON", () => {
    const csv = annexVIIIBToCsv(fields).split("\r\n");
    expect(csv[0]).toBe("point,field,value");
    expect(csv).toContain("9,memberStates,FR | BE");
    expect(csv).toContain("2,submitter,");
    const json = JSON.parse(annexVIIIBToJson(fields, now));
    expect(json).toMatchObject({ annex: "VIII", section: "B", exportedAt: now.toISOString() });
    expect(json.fields).toHaveLength(9);
  });

  it("27 États membres", () => {
    expect(new Set(EU_MEMBER_STATES).size).toBe(27);
  });
});
