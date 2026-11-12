// Évaluateur des contrôles semi-automatiques, clé `document.presentAndFresh` (PL-401, §12.3) : « présence et fraîcheur
// d'un fichier ou d'un document, contenu apprécié par un humain ». Fonction pure.
//
// Preuves retenues :
// - instantané de fichier GitHub (`github.file.snapshot`) dont le chemin correspond au paramètre `path` du contrôle
//   (chemin exact, ou préfixe s'il se termine par « / ») ; sans paramètre `path`, seulement un instantané rattaché
//   au contrôle par un utilisateur ;
// - toute autre preuve acceptée (téléversement, attestation) rattachée au contrôle par un utilisateur.
// Pour un fichier, seul le dernier instantané de chaque chemin compte : un fichier supprimé n'est plus présent.
import { z } from "zod";
import type { Evaluation } from "../evaluation";
import {
  isStale,
  newestFirst,
  reason,
  type EvaluableControl,
  type EvidenceRecord,
  type EvaluatorEntry,
} from "../engine";

const FILE_SNAPSHOT = "github.file.snapshot";

const filePayload = z.object({ path: z.string().min(1), present: z.boolean() });

const matchesPath = (path: string, expected: string) =>
  expected.endsWith("/") ? path.startsWith(expected) : path === expected;

export function evaluateDocument(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const expected = typeof control.params.path === "string" ? control.params.path : null;

  // Dernier instantané par chemin.
  const latestByPath = new Map<string, { record: EvidenceRecord; present: boolean }>();
  const documents: EvidenceRecord[] = [];
  for (const record of newestFirst(evidence)) {
    if (record.kind === FILE_SNAPSHOT) {
      const parsed = filePayload.safeParse(record.payload);
      if (!parsed.success) continue;
      const { path, present } = parsed.data;
      const relevant = expected ? matchesPath(path, expected) : record.linkedByUser;
      if (!relevant || latestByPath.has(path)) continue;
      latestByPath.set(path, { record, present });
    } else if (record.linkedByUser) {
      documents.push(record);
    }
  }
  const present = [
    ...[...latestByPath.values()].filter((f) => f.present).map((f) => f.record),
    ...documents,
  ];
  const absent = [...latestByPath.values()].filter((f) => !f.present).map((f) => f.record);

  if (present.length === 0 && absent.length === 0) {
    return {
      status: "MISSING",
      reasons: [
        expected
          ? reason(
              "NO_DOCUMENT",
              `Aucun document trouvé (${expected}).`,
              `No document found (${expected}).`,
            )
          : reason(
              "NO_DOCUMENT",
              "Aucun document rattaché à ce contrôle.",
              "No document attached to this control.",
            ),
      ],
      evidenceIds: [],
    };
  }
  if (present.length === 0) {
    const ids = absent.map((r) => r.id);
    return {
      status: "FAIL",
      reasons: [
        reason(
          "DOCUMENT_ABSENT",
          "Le document n'est plus présent dans le dépôt.",
          "The document is no longer present in the repository.",
          ids,
        ),
      ],
      evidenceIds: ids,
    };
  }
  const fresh = present.filter((r) => !isStale(r, control.freshnessDays, now));
  if (fresh.length === 0) {
    const ids = present.map((r) => r.id);
    return {
      status: "STALE",
      reasons: [
        reason(
          "DOCUMENT_STALE",
          "Le document est présent mais périmé.",
          "The document is present but out of date.",
          ids,
        ),
      ],
      evidenceIds: ids,
    };
  }
  const ids = fresh.map((r) => r.id);
  return {
    status: "PASS",
    reasons: [
      reason(
        "DOCUMENT_PRESENT",
        "Document présent et à jour ; son contenu reste apprécié par un humain.",
        "Document present and up to date; its content is assessed by a person.",
        ids,
      ),
    ],
    evidenceIds: ids,
  };
}

export const documentEvaluator: EvaluatorEntry = {
  version: "document.presentAndFresh@1",
  evaluate: evaluateDocument,
};
