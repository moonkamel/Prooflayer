// PL-206 — Bibliothèque de contrôles v1 : les 37 contrôles MVP du §12.3, dont 19 automatisés, validés par schéma,
// aux clés uniques, chacun rattaché à un évaluateur déclaré. Décomptes du cahier des charges : 6 contrôles pour un
// système exempté (§2.2, Recrutys), 37 pour un fournisseur à haut risque (§2.2, Talvio ; §9.4).
import { describe, expect, it } from "vitest";
import { EVALUATOR_KEYS } from "@/server/rules/evaluator-keys";
import { CONTROL_LIBRARY, LIBRARY_VERSION, applicableControls } from "@/server/rules/library";
import { ROLES, TIERS, controlSchema } from "@/server/rules/library/schema";

/** Contrôles marqués MVP au §12.3, par pack. */
const MVP_KEYS = {
  A: ["AIA-06-01", "AIA-06-02", "AIA-49-02", "AIA-05-01", "AIA-04-01", "AIA-50-01"],
  B: [
    ...["01", "02", "03", "04"].map((n) => `AIA-09-${n}`),
    ...["01", "02", "03"].map((n) => `AIA-10-${n}`),
    "AIA-11-01",
    "AIA-11-02",
    "AIA-12-01",
    "AIA-12-02",
    "AIA-13-01",
    "AIA-14-01",
    ...["01", "02", "03", "04", "05", "06"].map((n) => `AIA-15-${n}`),
  ],
  C: [
    ...["01", "02", "03", "04"].map((n) => `AIA-17-${n}`),
    "AIA-20-01",
    "AIA-43-01",
    "AIA-47-01",
    "AIA-48-01",
    "AIA-49-01",
    "AIA-72-01",
    "AIA-72-02",
    "AIA-73-01",
  ],
};

/** Contrôles automatiques (« A ») du §12.3. */
const AUTOMATED = [
  "AIA-06-01",
  "AIA-06-02",
  ...["01", "02", "03", "04"].map((n) => `AIA-09-${n}`),
  "AIA-11-02",
  ...["01", "02", "03", "04", "05", "06"].map((n) => `AIA-15-${n}`),
  "AIA-17-02",
  "AIA-17-03",
  "AIA-17-04",
  "AIA-20-01",
  "AIA-72-02",
  "AIA-73-01",
];

describe("bibliothèque de contrôles", () => {
  it("contient les 37 contrôles MVP du §12.3, par pack, aux clés uniques", () => {
    expect(LIBRARY_VERSION).toBe("2026.11.0");
    expect(CONTROL_LIBRARY).toHaveLength(37);
    expect(new Set(CONTROL_LIBRARY.map((c) => c.key)).size).toBe(37);
    for (const pack of ["A", "B", "C"] as const) {
      const keys = CONTROL_LIBRARY.filter((c) => c.pack === pack).map((c) => c.key);
      expect(keys.sort(), `pack ${pack}`).toEqual([...MVP_KEYS[pack]].sort());
    }
  });

  it("compte 19 contrôles automatisés, ceux marqués « A » au §12.3", () => {
    const automated = CONTROL_LIBRARY.filter((c) => c.automation === "AUTOMATED").map((c) => c.key);
    expect(automated.sort()).toEqual([...AUTOMATED].sort());
    expect(automated).toHaveLength(19);
  });

  it("chaque contrôle respecte le schéma et porte ses textes en français et en anglais", () => {
    for (const control of CONTROL_LIBRARY) {
      expect(() => controlSchema.parse(control), control.key).not.toThrow();
      for (const text of [control.title, control.statement]) {
        expect(text.fr).not.toBe(text.en);
      }
    }
    // Règle 7 de CLAUDE.md : jamais « conforme » ; on parle de preuve, pas de conformité acquise.
    expect(JSON.stringify(CONTROL_LIBRARY)).not.toMatch(/\bconforme\b|\bcompliant\b/u);
  });

  it("chaque contrôle a un évaluateur déclaré, et chaque évaluateur déclaré sert", () => {
    const used = new Set(CONTROL_LIBRARY.map((c) => c.evaluatorKey));
    for (const control of CONTROL_LIBRARY) {
      expect(Object.keys(EVALUATOR_KEYS), control.key).toContain(control.evaluatorKey);
    }
    expect([...used].sort()).toEqual(Object.keys(EVALUATOR_KEYS).sort());
    expect(CONTROL_LIBRARY.find((c) => c.key === "AIA-15-02")?.evaluatorKey).toBe(
      "github.peerReview",
    );
    // Un évaluateur propre à chaque contrôle automatisé (§9.6 : 9 GitHub, 4 internes, 6 Jira).
    const automatedKeys = CONTROL_LIBRARY.filter((c) => c.automation === "AUTOMATED").map(
      (c) => c.evaluatorKey,
    );
    expect(new Set(automatedKeys).size).toBe(19);
    expect(automatedKeys.filter((k) => k.startsWith("github."))).toHaveLength(9);
    expect(automatedKeys.filter((k) => k.startsWith("internal."))).toHaveLength(4);
    expect(automatedKeys.filter((k) => k.startsWith("jira."))).toHaveLength(6);
  });

  it("le pack A vise tous les systèmes du registre ; les packs B et C, le fournisseur à haut risque", () => {
    for (const control of CONTROL_LIBRARY) {
      if (control.pack === "A") {
        expect([...control.appliesToRoles].sort(), control.key).toEqual([...ROLES].sort());
        expect([...control.appliesToTiers].sort(), control.key).toEqual([...TIERS].sort());
      } else {
        expect(control.appliesToRoles, control.key).toEqual(["PROVIDER"]);
        expect(control.appliesToTiers, control.key).toEqual(["HIGH_RISK"]);
      }
    }
  });

  it("durées et seuils énoncés par le §12.3", () => {
    const of = (key: string) => CONTROL_LIBRARY.find((c) => c.key === key)!;
    expect(of("AIA-06-01").freshnessDays).toBe(365);
    expect(of("AIA-05-01").freshnessDays).toBe(365);
    expect(of("AIA-09-02").params).toMatchObject({ reviewDays: 90 });
    expect(of("AIA-15-02").params).toEqual({ windowDays: 90, minApprovals: 1 });
    expect(of("AIA-15-05").params).toEqual({ criticalMaxDays: 30, highMaxDays: 90 });
    expect(of("AIA-12-02").params).toEqual({ minRetentionDays: 183 });
    expect(of("AIA-17-04").params).toEqual({ maxIntervalDays: 183 });
    expect(of("AIA-72-02").params).toEqual({ reviewDays: 92 });
  });
});

describe("contrôles applicables", () => {
  it("fournisseur à haut risque : 37 contrôles, dont 19 évaluables automatiquement (§9.4)", () => {
    const controls = applicableControls("HIGH_RISK", "PROVIDER");
    expect(controls).toHaveLength(37);
    expect(controls.filter((c) => c.automation === "AUTOMATED")).toHaveLength(19);
  });

  it("système exempté : 6 contrôles ; reclassé haut risque : 31 de plus (§2.2, Recrutys)", () => {
    const exempt = applicableControls("HIGH_RISK_EXEMPT_ART6_3", "PROVIDER");
    expect(exempt.map((c) => c.pack)).toEqual(Array(6).fill("A"));
    expect(applicableControls("HIGH_RISK", "PROVIDER").length - exempt.length).toBe(31);
  });

  it("déployeur d'un système à haut risque : pack A seul tant que le pack D (V1) n'est pas livré", () => {
    expect(applicableControls("HIGH_RISK", "DEPLOYER")).toHaveLength(6);
  });

  it("une pratique interdite ou un système non classifié n'ouvre aucun contrôle", () => {
    expect(applicableControls("PROHIBITED", "PROVIDER")).toEqual([]);
    expect(applicableControls("UNCLASSIFIED", "PROVIDER")).toEqual([]);
  });
});
