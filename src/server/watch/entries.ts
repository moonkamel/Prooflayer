// Fil de veille réglementaire (PL-603, §3.2 E12 version minimale) : entrées rédigées et publiées par ProofLayer, dans
// ce fichier versionné. Chaque entrée porte sa source, sa date d'effet et les contrôles concernés. Une entrée publiée
// n'est jamais modifiée sur le fond : une évolution fait l'objet d'une nouvelle entrée. Textes en français et en
// anglais dans l'entrée même (comme la bibliothèque de contrôles, PL-206). Jamais le mot « conforme ».
import { z } from "zod";

const text = z.object({ fr: z.string().min(1), en: z.string().min(1) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const watchEntrySchema = z.object({
  /** Identifiant stable, `AAAA-MM-JJ-sujet`. */
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/u),
  /** Date de publication par ProofLayer : l'entrée apparaît et les administrateurs sont prévenus à partir de ce jour. */
  publishedAt: day,
  /** Date d'effet de la règle décrite. */
  effectiveAt: day,
  title: text,
  summary: text,
  /** Source (texte et article), lisible ; l'adresse du règlement vient de `regulationUrl`. */
  source: text,
  /** « info » : à connaître ; « action_required » : un contrôle ou une preuve est à revoir. */
  severity: z.enum(["info", "action_required"]),
  /** Contrôles de la bibliothèque concernés (clés). */
  controls: z.array(z.string().regex(/^AIA-\d{2}-\d{2}$/u)),
});
export type WatchEntry = z.infer<typeof watchEntrySchema>;

// Entrées initiales : faits du calage réglementaire du cahier des charges (§1.5, état au 10 novembre 2026).
export const WATCH_ENTRIES: readonly WatchEntry[] = [
  {
    id: "2026-11-14-omnibus-echeances",
    publishedAt: "2026-11-14",
    effectiveAt: "2026-07-27",
    title: {
      fr: "Règlement (UE) 2026/1744 : échéances fixes pour les systèmes à haut risque",
      en: "Regulation (EU) 2026/1744: fixed deadlines for high-risk systems",
    },
    summary: {
      fr: "L'échéance des systèmes de l'Annexe III est fixée au 2 décembre 2027, celle de l'Annexe I au 2 août 2028 ; le mécanisme conditionnel lié aux normes est abandonné. Un système à haut risque déjà mis sur le marché avant la date d'application n'est soumis au règlement que si sa conception subit des modifications importantes après cette date : tracez vos changements de conception.",
      en: "The deadline for Annex III systems is set at 2 December 2027, and for Annex I at 2 August 2028; the conditional mechanism tied to standards is dropped. A high-risk system already placed on the market before the date of application is subject to the Regulation only if its design undergoes significant changes after that date: record your design changes.",
    },
    source: {
      fr: "Règlement (UE) 2026/1744, Art. 113 modifié ; Art. 111(2)",
      en: "Regulation (EU) 2026/1744, amended Art. 113; Art. 111(2)",
    },
    severity: "action_required",
    controls: ["AIA-06-01", "AIA-17-02"],
  },
  {
    id: "2026-11-14-art50-marquage",
    publishedAt: "2026-11-14",
    effectiveAt: "2026-12-02",
    title: {
      fr: "Art. 50 : marquage des contenus synthétiques des systèmes antérieurs",
      en: "Art. 50: marking of synthetic content for earlier systems",
    },
    summary: {
      fr: "Les obligations de transparence de l'Art. 50 s'appliquent depuis le 2 août 2026. Pour les systèmes mis sur le marché avant cette date, le marquage des contenus synthétiques est attendu au 2 décembre 2026.",
      en: "The transparency obligations of Art. 50 apply since 2 August 2026. For systems placed on the market before that date, marking of synthetic content is expected by 2 December 2026.",
    },
    source: { fr: "Art. 50, Art. 111(4)", en: "Art. 50, Art. 111(4)" },
    severity: "action_required",
    controls: ["AIA-50-01"],
  },
  {
    id: "2026-11-14-art4-maitrise",
    publishedAt: "2026-11-14",
    effectiveAt: "2025-02-02",
    title: {
      fr: "Art. 4 réécrit : soutenir la maîtrise de l'IA",
      en: "Art. 4 rewritten: supporting AI literacy",
    },
    summary: {
      fr: "L'Art. 4 demande désormais de « prendre des mesures pour soutenir » la maîtrise de l'IA, au lieu de garantir un niveau. Il s'applique depuis le 2 février 2025. La preuve attendue reste le registre de formation.",
      en: 'Art. 4 now requires "taking measures to support" AI literacy, instead of ensuring a level. It applies since 2 February 2025. The expected evidence remains the training register.',
    },
    source: { fr: "Art. 4 modifié", en: "Amended Art. 4" },
    severity: "info",
    controls: ["AIA-04-01"],
  },
];

/** Entrées publiées à la date donnée, de la plus récente à la plus ancienne. */
export function publishedEntries(now: Date, entries: readonly WatchEntry[] = WATCH_ENTRIES) {
  const today = now.toISOString().slice(0, 10);
  return [...entries]
    .filter((e) => e.publishedAt <= today)
    .sort((a, b) =>
      a.publishedAt === b.publishedAt
        ? a.id < b.id
          ? 1
          : -1
        : a.publishedAt < b.publishedAt
          ? 1
          : -1,
    );
}
