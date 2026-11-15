// PL-604 — Mise en route : 5 étapes déduites de l'état, étape en cours = première non faite, liens vers le système ;
// statut « en attente » d'un contrôle jamais évalué pendant la capture.
import { describe, expect, it } from "vitest";
import { captureStatus, onboardingSteps } from "@/server/services/onboarding-data";

const none = {
  systemId: null,
  classified: false,
  connected: false,
  captured: false,
  packed: false,
};

describe("liste de mise en route", () => {
  it("rien de fait : première étape en cours, liens vers le registre", () => {
    const r = onboardingSteps(none);
    expect(r.steps.map((s) => s.id)).toEqual(["system", "classify", "connect", "evidence", "pack"]);
    expect(r).toMatchObject({ current: "system", done: 0, complete: false });
    expect(r.steps.every((s) => s.href === "/systems" || s.href === "/organization")).toBe(true);
  });

  it("système créé : liens vers ce système ; étape en cours = première non faite, même dans le désordre", () => {
    const r = onboardingSteps({ ...none, systemId: "sys_1", connected: true });
    expect(r.current).toBe("classify");
    expect(r.done).toBe(2);
    expect(r.steps.find((s) => s.id === "evidence")!.href).toBe("/systems/sys_1/capture");
    expect(r.steps.find((s) => s.id === "pack")!.href).toBe("/systems/sys_1/packs");
  });

  it("tout fait : liste terminée", () => {
    const r = onboardingSteps({
      systemId: "s",
      classified: true,
      connected: true,
      captured: true,
      packed: true,
    });
    expect(r).toMatchObject({ current: null, done: 5, complete: true });
  });

  it("capture : en attente tant que jamais évalué ; non applicable prime", () => {
    expect(captureStatus({ status: "MISSING", notApplicable: false, evaluatedAt: null })).toBe(
      "PENDING",
    );
    expect(captureStatus({ status: "PASS", notApplicable: false, evaluatedAt: new Date() })).toBe(
      "PASS",
    );
    expect(captureStatus({ status: "MISSING", notApplicable: true, evaluatedAt: null })).toBe(
      "NOT_APPLICABLE",
    );
  });
});
