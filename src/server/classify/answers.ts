// Réponses au questionnaire de classification (PL-202, prompt-type du §9.4). Schéma Zod partagé par le moteur,
// le questionnaire (PL-203) et le classifieur public (PL-208). Aucune dépendance à la base ni au réseau.
import { z } from "zod";

/** Points de l'Annexe III (§12.2). Le point 2 n'a pas de sous-point. */
export const ANNEX_III_POINTS = [
  "1(a)",
  "1(b)",
  "1(c)",
  "2",
  "3(a)",
  "3(b)",
  "3(c)",
  "3(d)",
  "4(a)",
  "4(b)",
  "5(a)",
  "5(b)",
  "5(c)",
  "5(d)",
  "6(a)",
  "6(b)",
  "6(c)",
  "6(d)",
  "6(e)",
  "7(a)",
  "7(b)",
  "7(c)",
  "7(d)",
  "8(a)",
  "8(b)",
] as const;
export type AnnexIIIPoint = (typeof ANNEX_III_POINTS)[number];

/** Pratiques interdites de l'Art. 5(1), points a à h. */
export const PROHIBITED_PRACTICES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type ProhibitedPractice = (typeof PROHIBITED_PRACTICES)[number];

/** Conditions de l'Art. 6(3) : a) tâche procédurale étroite ; b) amélioration d'une activité humaine achevée ;
 * c) détection de schémas sans remplacer l'évaluation humaine ; d) tâche préparatoire. */
export const ART_6_3_CONDITIONS = ["a", "b", "c", "d"] as const;
export type Art63Condition = (typeof ART_6_3_CONDITIONS)[number];

export const answersSchema = z
  .object({
    isAiSystem: z.boolean(),
    inScope: z.boolean(),
    prohibitedPractices: z.array(z.enum(PROHIBITED_PRACTICES)),
    annexISafetyComponent: z.boolean(),
    annexIIIPoints: z.array(z.enum(ANNEX_III_POINTS)),
    performsProfiling: z.boolean(),
    art63Conditions: z.array(z.enum(ART_6_3_CONDITIONS)),
    interactsWithPersons: z.boolean(),
    generatesSyntheticContent: z.boolean(),
    developsSystem: z.boolean(),
    ownBrand: z.boolean(),
    substantialModification: z.boolean(),
    changedPurpose: z.boolean(),
  })
  .strict();

export type Answers = z.infer<typeof answersSchema>;
export type AnswerKey = keyof Answers;
