// PL-405 — Preuves manuelles : types et contenus acceptés, jetons signés, évaluateur manual.evidencePresent
// (succès, périmé par la validité ou la fraîcheur, absent).
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/server/crypto/signed-token";
import type { EvaluableControl, EvidenceRecord } from "@/server/rules/engine";
import { evaluateManualEvidence } from "@/server/rules/evaluators/manual";
import { checkUploadType, contentMatches, UPLOAD_TYPES } from "@/server/services/manual-evidence";

const now = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;

describe("types et contenus acceptés (§3.2 E5)", () => {
  it("PDF, DOCX, PNG, JPG, MD, CSV, avec extension et type MIME cohérents", () => {
    expect(checkUploadType("Déclaration UE.pdf", "application/pdf")).toBe("pdf");
    expect(checkUploadType("photo.JPG", "image/jpeg")).toBe("jpg");
    expect(checkUploadType("registre.csv", "text/csv")).toBe("csv");
    for (const [name, type] of [
      ["script.exe", "application/octet-stream"],
      ["photo.png", "application/pdf"],
      ["sans-extension", "application/pdf"],
      ["page.html", "text/html"],
    ]) {
      expect(() => checkUploadType(name!, type!), name).toThrow("evidence.unsupportedType");
    }
    expect(Object.keys(UPLOAD_TYPES)).toEqual(["pdf", "docx", "png", "jpg", "jpeg", "md", "csv"]);
  });

  it("le contenu doit correspondre au type annoncé", () => {
    expect(contentMatches(Buffer.from("%PDF-1.7\n…"), "application/pdf")).toBe(true);
    expect(contentMatches(Buffer.from("<html>"), "application/pdf")).toBe(false);
    expect(
      contentMatches(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "image/png"),
    ).toBe(true);
    expect(contentMatches(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("....word/document.xml"),
    ]);
    expect(contentMatches(docx, UPLOAD_TYPES.docx.mime)).toBe(true);
    expect(
      contentMatches(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), UPLOAD_TYPES.docx.mime),
    ).toBe(false);
    expect(contentMatches(Buffer.from("a;b\n1;2\n", "utf8"), "text/csv")).toBe(true);
    expect(contentMatches(Buffer.from("# Notice\n\nTexte é", "utf8"), "text/markdown")).toBe(true);
    expect(contentMatches(Buffer.from([0x61, 0x00, 0x62]), "text/csv")).toBe(false);
    expect(contentMatches(Buffer.from([0xc3, 0x28]), "text/markdown")).toBe(false);
    expect(contentMatches(Buffer.from("x"), "application/zip")).toBe(false);
  });
});

describe("jetons signés", () => {
  const secret = "secret-0123456789-0123456789";
  it("usage, échéance et signature vérifiés", () => {
    const token = signToken(
      { a: 1 },
      { secret, purpose: "p", expiresAt: new Date(now.getTime() + 1000) },
    );
    expect(verifyToken(token, { secret, purpose: "p", now })).toMatchObject({ a: 1 });
    expect(verifyToken(token, { secret, purpose: "autre", now })).toBeNull();
    expect(verifyToken(token, { secret: "autre-secret", purpose: "p", now })).toBeNull();
    expect(
      verifyToken(token, { secret, purpose: "p", now: new Date(now.getTime() + 2000) }),
    ).toBeNull();
    expect(verifyToken(`${token}x`, { secret, purpose: "p", now })).toBeNull();
    expect(verifyToken("a.b.c", { secret, purpose: "p", now })).toBeNull();
  });
});

describe("manual.evidencePresent", () => {
  const control: EvaluableControl = {
    key: "AIA-05-01",
    evaluatorKey: "manual.evidencePresent",
    evidenceKinds: ["manual.attestation"],
    freshnessDays: 365,
    params: {},
  };
  let seq = 0;
  const ev = (o: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    id: `ev_${++seq}`,
    kind: "manual.attestation",
    resourceId: null,
    occurredAt: new Date(now.getTime() - 10 * DAY),
    capturedAt: new Date(now.getTime() - 10 * DAY),
    payload: {},
    declarative: true,
    validUntil: new Date(now.getTime() + 100 * DAY),
    linkedByUser: true,
    ...o,
  });

  it("succès : preuve rattachée en cours de validité, marquée déclarative", () => {
    const r = evaluateManualEvidence(control, [ev()], now);
    expect(r.status).toBe("PASS");
    expect(r.reasons[0]!.code).toBe("DECLARATIVE_EVIDENCE_PRESENT");
    expect(r.reasons[0]!.message.fr).toMatch(/déclarative/u);
    expect(r.reasons[0]!.message.fr).not.toMatch(/conforme/iu);
  });

  it("périmé : validité dépassée, ou durée de fraîcheur du contrôle dépassée (revue annuelle)", () => {
    expect(
      evaluateManualEvidence(control, [ev({ validUntil: new Date(now.getTime() - DAY) })], now)
        .status,
    ).toBe("STALE");
    const old = ev({
      occurredAt: new Date(now.getTime() - 400 * DAY),
      validUntil: new Date(now.getTime() + DAY),
    });
    expect(evaluateManualEvidence(control, [old], now).status).toBe("STALE");
    // Une preuve encore valable suffit.
    expect(evaluateManualEvidence(control, [old, ev()], now).status).toBe("PASS");
  });

  it("absent : aucune preuve rattachée par un utilisateur", () => {
    expect(evaluateManualEvidence(control, [], now).status).toBe("MISSING");
    expect(evaluateManualEvidence(control, [ev({ linkedByUser: false })], now).status).toBe(
      "MISSING",
    );
  });
});
