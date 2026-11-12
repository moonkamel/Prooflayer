// PL-207 — Plan d'instanciation des contrôles : création, non-applicabilité après reclassification, réouverture.
import { describe, expect, it } from "vitest";
import {
  NA_BY_RECLASSIFICATION,
  planInstances,
  type ExistingInstance,
} from "@/server/rules/instantiate";

const instance = (definitionId: string, na: false | string = false): ExistingInstance => ({
  id: `ci_${definitionId}`,
  definitionId,
  notApplicable: na !== false,
  naJustification: na === false ? null : na,
});

describe("planInstances", () => {
  it("première signature : une instance par définition applicable", () => {
    expect(planInstances(["a", "b", "c"], [])).toEqual({
      create: ["a", "b", "c"],
      markNotApplicable: [],
      reactivate: [],
    });
  });

  it("même classification signée de nouveau : rien à faire", () => {
    expect(planInstances(["a", "b"], [instance("a"), instance("b")])).toEqual({
      create: [],
      markNotApplicable: [],
      reactivate: [],
    });
  });

  it("reclassification vers plus d'exigences : ajoute les contrôles manquants", () => {
    expect(planInstances(["a", "b", "c"], [instance("a")]).create).toEqual(["b", "c"]);
  });

  it("reclassification vers moins d'exigences : marque non applicable, sans rien supprimer", () => {
    const plan = planInstances(["a"], [instance("a"), instance("b"), instance("c")]);
    expect(plan).toEqual({ create: [], markNotApplicable: ["ci_b", "ci_c"], reactivate: [] });
  });

  it("un contrôle écarté par reclassification est rouvert quand il s'applique de nouveau", () => {
    const plan = planInstances(["a", "b"], [instance("a"), instance("b", NA_BY_RECLASSIFICATION)]);
    expect(plan).toEqual({ create: [], markNotApplicable: [], reactivate: ["ci_b"] });
  });

  it("une non-applicabilité décidée par un administrateur n'est jamais levée ni réécrite", () => {
    const manual = instance("b", "Sans objet : aucun jeu de données d'entraînement");
    expect(planInstances(["a", "b"], [instance("a"), manual])).toEqual({
      create: [],
      markNotApplicable: [],
      reactivate: [],
    });
    // Elle ne s'applique plus : déjà non applicable, sa justification est conservée.
    expect(planInstances(["a"], [instance("a"), manual]).markNotApplicable).toEqual([]);
  });
});
