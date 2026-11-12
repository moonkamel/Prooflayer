// AIA-17-02, clé `github.changeManagementFiles` (§12.3) : « gestion des changements outillée : gabarit de PR avec liste
// de contrôle, CODEOWNERS sur les répertoires de modèle et de données ». Fonction pure. Seuls la présence et
// l'empreinte des fichiers sont capturées (aucun contenu, §4.5.1) : l'évaluateur vérifie que chaque dépôt observé a
// un gabarit de PR et un fichier CODEOWNERS aux emplacements reconnus par GitHub ; la liste de contrôle du gabarit et
// la couverture des répertoires par CODEOWNERS ne sont pas lues.
import { z } from "zod";
import { reason, type EvaluableControl, type EvidenceRecord, type EvaluatorEntry } from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { latestBy, missing, parsed, result, staleness } from "./common";

const file = z.object({ path: z.string(), present: z.boolean() });

/** Emplacements reconnus par GitHub (insensibles à la casse). */
const PR_TEMPLATE = [
  /^pull_request_template\.md$/iu,
  /^(\.github|docs)\/pull_request_template\.md$/iu,
  /^(\.github\/|docs\/)?pull_request_template\/[^/]+\.md$/iu,
];
const CODEOWNERS = [/^(\.github\/|docs\/)?codeowners$/iu];

const kindOf = (path: string) =>
  PR_TEMPLATE.some((r) => r.test(path))
    ? "template"
    : CODEOWNERS.some((r) => r.test(path))
      ? "codeowners"
      : null;

export function evaluateChangeManagementFiles(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const latest = latestBy(
    parsed(evidence, "github.file.snapshot", file).filter((f) => kindOf(f.data.path) !== null),
    (f) => `${f.record.resourceId ?? ""}:${f.data.path.toLowerCase()}`,
  );
  if (latest.length === 0) {
    return missing(
      "NO_CHANGE_FILES",
      "Ni gabarit de PR ni CODEOWNERS capturé.",
      "No pull request template or CODEOWNERS captured.",
    );
  }
  const stale = staleness(
    control,
    latest.map((f) => f.record),
    now,
  );
  if (stale) return stale;

  const repos = new Map<string, { template: string[]; codeowners: string[] }>();
  for (const f of latest) {
    const repo = f.record.resourceId ?? "";
    const entry = repos.get(repo) ?? { template: [], codeowners: [] };
    if (f.data.present) entry[kindOf(f.data.path)!].push(f.record.id);
    repos.set(repo, entry);
  }
  const ids = [...repos.values()].flatMap((r) => [...r.template, ...r.codeowners]);
  const problems: EvaluationReason[] = [];
  let satisfied = 0;
  let expected = 0;
  for (const entry of repos.values()) {
    expected += 2;
    if (entry.template.length > 0) satisfied += 1;
    else
      problems.push(
        reason(
          "NO_PR_TEMPLATE",
          "Un dépôt n'a pas de gabarit de PR.",
          "A repository has no pull request template.",
        ),
      );
    if (entry.codeowners.length > 0) satisfied += 1;
    else
      problems.push(
        reason(
          "NO_CODEOWNERS",
          "Un dépôt n'a pas de fichier CODEOWNERS.",
          "A repository has no CODEOWNERS file.",
        ),
      );
  }
  if (satisfied === 0) return result("FAIL", problems, ids);
  if (satisfied < expected) return result("PARTIAL", problems, ids);
  return result(
    "PASS",
    [
      reason(
        "CHANGE_FILES_PRESENT",
        "Gabarit de PR et CODEOWNERS présents sur chaque dépôt ; leur contenu reste apprécié par un humain.",
        "Pull request template and CODEOWNERS present on each repository; their content is assessed by a person.",
        ids,
      ),
    ],
    ids,
  );
}

export const changeManagementFilesEvaluator: EvaluatorEntry = {
  version: "github.changeManagementFiles@1",
  evaluate: evaluateChangeManagementFiles,
};
