// PL-401 — Moteur d'évaluation pur et évaluateur `document.presentAndFresh` (succès, échec, périmé, absent).
import { describe, expect, it } from "vitest";
import {
  evaluate,
  isStale,
  newestFirst,
  type EvaluableControl,
  type EvidenceRecord,
} from "@/server/rules/engine";
import { EVALUATORS } from "@/server/rules/evaluators";
import { evaluateDocument } from "@/server/rules/evaluators/document";
import { EVALUATOR_KEYS } from "@/server/rules/evaluator-keys";
import { CONTROL_LIBRARY } from "@/server/rules/library";

const now = new Date("2026-11-12T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

let seq = 0;
function ev(partial: Partial<EvidenceRecord> & { kind: string }): EvidenceRecord {
  seq += 1;
  return {
    id: `ev_${String(seq).padStart(3, "0")}`,
    resourceId: "res_1",
    occurredAt: daysAgo(1),
    capturedAt: daysAgo(1),
    payload: null,
    declarative: false,
    validUntil: null,
    linkedByUser: false,
    ...partial,
  };
}
const file = (path: string, present: boolean, ageDays = 1, extra: Partial<EvidenceRecord> = {}) =>
  ev({
    kind: "github.file.snapshot",
    occurredAt: daysAgo(ageDays),
    capturedAt: daysAgo(ageDays),
    payload: {
      path,
      ref: "main",
      present,
      blobSha: present ? "abc" : null,
      size: present ? 10 : null,
    },
    ...extra,
  });

const control = (overrides: Partial<EvaluableControl> = {}): EvaluableControl => ({
  key: "AIA-13-01",
  evaluatorKey: "document.presentAndFresh",
  evidenceKinds: ["github.file.snapshot", "manual.upload"],
  freshnessDays: null,
  params: { path: "docs/ai/instructions-for-use.md" },
  ...overrides,
});

describe("moteur", () => {
  it("sans évaluateur livré, aucune évaluation", () => {
    expect(
      evaluate(control({ evaluatorKey: "jira.riskRegisterExists" }), [], now, EVALUATORS),
    ).toBeNull();
  });

  it("ne transmet que les preuves des types acceptés, et donne la version de l'évaluateur", () => {
    const seen: string[] = [];
    const result = evaluate(
      control(),
      [file("docs/ai/instructions-for-use.md", true), ev({ kind: "github.release.published" })],
      now,
      {
        "document.presentAndFresh": {
          version: "test@1",
          evaluate: (_c, evidence) => {
            seen.push(...evidence.map((e) => e.kind));
            return { status: "PASS", reasons: [], evidenceIds: [] };
          },
        },
      },
    );
    expect(result?.evaluatorVersion).toBe("test@1");
    expect(seen).toEqual(["github.file.snapshot"]);
  });

  it("chaque évaluateur livré est déclaré dans EVALUATOR_KEYS et sert au moins un contrôle", () => {
    for (const key of Object.keys(EVALUATORS)) {
      expect(key in EVALUATOR_KEYS).toBe(true);
      expect(CONTROL_LIBRARY.some((c) => c.evaluatorKey === key)).toBe(true);
    }
  });

  it("péremption : durée de fraîcheur dépassée, ou date de validité passée", () => {
    expect(isStale(ev({ kind: "x", occurredAt: daysAgo(31) }), 30, now)).toBe(true);
    expect(isStale(ev({ kind: "x", occurredAt: daysAgo(29) }), 30, now)).toBe(false);
    expect(isStale(ev({ kind: "x", occurredAt: daysAgo(900) }), null, now)).toBe(false);
    expect(isStale(ev({ kind: "x", validUntil: daysAgo(1) }), null, now)).toBe(true);
    expect(isStale(ev({ kind: "x", validUntil: daysAgo(-1) }), null, now)).toBe(false);
  });

  it("tri stable : date de la source, puis de capture, puis identifiant", () => {
    const a = ev({ kind: "x", occurredAt: daysAgo(2) });
    const b = ev({ kind: "x", occurredAt: daysAgo(1), capturedAt: daysAgo(1) });
    const c = ev({ kind: "x", occurredAt: daysAgo(1), capturedAt: daysAgo(0) });
    expect(newestFirst([a, b, c]).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe("document.presentAndFresh", () => {
  it("succès : document présent au chemin attendu → PASS, contenu laissé à l'appréciation humaine", () => {
    const doc = file("docs/ai/instructions-for-use.md", true);
    const result = evaluateDocument(control(), [doc, file("CODEOWNERS", true)], now);
    expect(result.status).toBe("PASS");
    expect(result.evidenceIds).toEqual([doc.id]);
    expect(result.reasons[0]).toMatchObject({ code: "DOCUMENT_PRESENT", evidenceIds: [doc.id] });
    expect(result.reasons[0]!.message.fr).not.toMatch(/conforme/iu);
  });

  it("échec : le dernier instantané dit le fichier supprimé → FAIL", () => {
    const before = file("docs/ai/instructions-for-use.md", true, 10);
    const after = file("docs/ai/instructions-for-use.md", false, 2);
    const result = evaluateDocument(control(), [before, after], now);
    expect(result).toMatchObject({ status: "FAIL", evidenceIds: [after.id] });
    expect(result.reasons[0]!.code).toBe("DOCUMENT_ABSENT");
    // Recréé ensuite : de nouveau présent.
    const again = file("docs/ai/instructions-for-use.md", true, 1);
    expect(evaluateDocument(control(), [before, after, again], now).status).toBe("PASS");
  });

  it("périmé : seul document au-delà de sa durée de fraîcheur, ou attestation expirée → STALE", () => {
    const old = file("docs/ai/instructions-for-use.md", true, 400);
    expect(evaluateDocument(control({ freshnessDays: 365 }), [old], now).status).toBe("STALE");
    expect(evaluateDocument(control({ freshnessDays: null }), [old], now).status).toBe("PASS");
    const upload = ev({
      kind: "manual.upload",
      declarative: true,
      linkedByUser: true,
      validUntil: daysAgo(3),
    });
    const result = evaluateDocument(control(), [upload], now);
    expect(result).toMatchObject({ status: "STALE", evidenceIds: [upload.id] });
  });

  it("absent : aucune preuve, ou seulement d'autres chemins → MISSING", () => {
    expect(evaluateDocument(control(), [], now)).toMatchObject({
      status: "MISSING",
      evidenceIds: [],
    });
    const result = evaluateDocument(control(), [file("docs/ai/other.md", true)], now);
    expect(result.status).toBe("MISSING");
    expect(result.reasons[0]!.message.en).toContain("docs/ai/instructions-for-use.md");
  });

  it("préfixe de répertoire : un fichier présent sous docs/ai/datasheets/ suffit", () => {
    const c = control({ key: "AIA-10-01", params: { path: "docs/ai/datasheets/" } });
    const sheet = file("docs/ai/datasheets/train.md", true);
    expect(
      evaluateDocument(c, [sheet, file("docs/ai/datasheets/test.md", false)], now),
    ).toMatchObject({ status: "PASS", evidenceIds: [sheet.id] });
    expect(evaluateDocument(c, [file("docs/ai/datasheets.md", true)], now).status).toBe("MISSING");
  });

  it("sans chemin dans le contrôle : seules les preuves rattachées par un utilisateur comptent", () => {
    const c = control({ key: "AIA-50-01", params: {} });
    const unlinked = file("docs/ai/transparency.md", true);
    const upload = ev({ kind: "manual.upload", declarative: true });
    expect(evaluateDocument(c, [unlinked, upload], now).status).toBe("MISSING");
    const linked = file("docs/ai/transparency.md", true, 1, { linkedByUser: true });
    expect(evaluateDocument(c, [linked], now)).toMatchObject({ status: "PASS" });
    const linkedUpload = ev({ kind: "manual.upload", declarative: true, linkedByUser: true });
    expect(evaluateDocument(c, [linkedUpload], now).status).toBe("PASS");
  });

  it("charge effacée ou invalide : l'instantané est ignoré", () => {
    const redacted = ev({ kind: "github.file.snapshot", payload: null });
    expect(evaluateDocument(control(), [redacted], now).status).toBe("MISSING");
  });
});
