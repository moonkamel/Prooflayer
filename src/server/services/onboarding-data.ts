// Mise en route guidée (PL-604, parcours du §5.1) : liste en 5 étapes déduite de l'état de l'organisation, jamais
// déclarée par l'utilisateur. Fonctions pures.
export const ONBOARDING_STEPS = ["system", "classify", "connect", "evidence", "pack"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingFacts {
  /** Premier système du registre (non archivé), cible des liens des étapes suivantes. */
  systemId: string | null;
  /** Une classification signée existe. */
  classified: boolean;
  /** Une intégration GitHub ou Jira active existe. */
  connected: boolean;
  /** Au moins une preuve capturée depuis une source (hors preuves émises par ProofLayer). */
  captured: boolean;
  /** Au moins un pack d'audit prêt. */
  packed: boolean;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  href: string;
}

export function onboardingSteps(facts: OnboardingFacts) {
  const system = facts.systemId ? `/systems/${facts.systemId}` : "/systems";
  const steps: OnboardingStep[] = [
    { id: "system", done: facts.systemId !== null, href: "/systems" },
    {
      id: "classify",
      done: facts.classified,
      href: facts.systemId ? `${system}/classification` : "/systems",
    },
    { id: "connect", done: facts.connected, href: "/organization" },
    {
      id: "evidence",
      done: facts.captured,
      href: facts.systemId ? `${system}/capture` : "/systems",
    },
    { id: "pack", done: facts.packed, href: facts.systemId ? `${system}/packs` : "/systems" },
  ];
  const current = steps.find((s) => !s.done)?.id ?? null;
  return { steps, current, done: steps.filter((s) => s.done).length, complete: current === null };
}

/** Statut d'un contrôle pendant la capture : « en attente » tant qu'il n'a jamais été évalué (§5.1, écran 7). */
export function captureStatus(control: {
  status: string;
  notApplicable: boolean;
  evaluatedAt: Date | null;
}) {
  if (control.notApplicable) return "NOT_APPLICABLE" as const;
  return control.evaluatedAt ? (control.status as "PASS") : ("PENDING" as const);
}
