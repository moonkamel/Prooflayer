// Instanciation des contrôles d'un système (PL-207, §9.4, §3.2 E6). Fonction pure : à partir des définitions qui
// s'appliquent à la catégorie et au rôle signés, et des instances déjà présentes, elle dit quoi créer, quoi marquer
// non applicable et quoi réactiver. Rien n'est jamais supprimé : l'historique d'un contrôle reste attaché à son instance.

/** Justification posée par une reclassification. Une non-applicabilité décidée par un administrateur (PL-407)
 * porte un texte libre et n'est jamais levée automatiquement. */
export const NA_BY_RECLASSIFICATION = "auto:reclassification";

export interface ExistingInstance {
  id: string;
  definitionId: string;
  notApplicable: boolean;
  naJustification: string | null;
}

export interface InstancePlan {
  /** Définitions applicables sans instance : à créer. */
  create: string[];
  /** Instances dont la définition ne s'applique plus : à marquer non applicables. */
  markNotApplicable: string[];
  /** Instances écartées par une reclassification précédente et de nouveau applicables : à rouvrir. */
  reactivate: string[];
}

export function planInstances(
  applicableDefinitionIds: readonly string[],
  existing: readonly ExistingInstance[],
): InstancePlan {
  const applicable = new Set(applicableDefinitionIds);
  const known = new Set(existing.map((i) => i.definitionId));
  return {
    create: applicableDefinitionIds.filter((id) => !known.has(id)),
    markNotApplicable: existing
      .filter((i) => !applicable.has(i.definitionId) && !i.notApplicable)
      .map((i) => i.id),
    reactivate: existing
      .filter(
        (i) =>
          applicable.has(i.definitionId) &&
          i.notApplicable &&
          i.naJustification === NA_BY_RECLASSIFICATION,
      )
      .map((i) => i.id),
  };
}
