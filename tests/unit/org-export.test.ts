// PL-607 — Format de l'export complet (pur) : valeurs JSON lisibles (octets en hexadécimal, dates ISO), chemins
// stables, manifeste avec l'empreinte de chaque fichier, décomptes.
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportFiles, plain, zipExport, type ExportInput } from "@/server/export/contents";

const input = (): ExportInput => ({
  organization: { id: "org_1", name: "Talvio", slug: "talvio" },
  exportedAt: new Date("2026-11-15T12:00:00Z"),
  members: [{ userId: "u1", role: "owner" }],
  systems: [{ id: "sys_1", createdAt: new Date("2026-10-01T00:00:00Z") }],
  designChanges: [],
  classifications: [{ id: "cls_1" }],
  exemptions: [],
  controls: [{ id: "ci_1" }],
  evaluations: [],
  comments: [],
  evidenceLinks: [],
  integrations: [],
  sealBatches: [{ seq: 1, merkleRoot: new Uint8Array([0xab, 0x01]) }],
  auditLog: [{ action: "org.export" }],
  packs: [
    { meta: { id: "pck_1", status: "READY" }, zip: new Uint8Array([0x50, 0x4b]) },
    { meta: { id: "pck_2", status: "FAILED" }, zip: null },
  ],
  evidence: [
    {
      row: { id: "ev_1", contentSha256: new Uint8Array([1, 2]) },
      raw: new TextEncoder().encode('{"a":1}'),
      attachment: { bytes: new Uint8Array([9]), extension: "pdf" },
    },
    {
      row: { id: "ev_2", redactedAt: new Date("2026-11-02T00:00:00Z") },
      raw: null,
      attachment: null,
    },
  ],
});

describe("export complet", () => {
  it("valeurs JSON : octets en hexadécimal, dates ISO, imbrication parcourue", () => {
    expect(
      plain({ a: new Uint8Array([0, 255]), d: new Date("2026-01-01T00:00:00Z"), n: [1n] }),
    ).toEqual({
      a: "00ff",
      d: "2026-01-01T00:00:00.000Z",
      n: ["1"],
    });
  });

  it("chemins : une preuve, sa charge brute, sa pièce jointe ; packs prêts seulement", () => {
    const files = [...exportFiles(input()).keys()];
    expect(files).toEqual(
      expect.arrayContaining([
        "registry/systems.json",
        "evidence/ev_1.json",
        "evidence/ev_1.raw.json",
        "evidence/ev_1.pdf",
        "evidence/ev_2.json",
        "packs/pck_1.zip",
        "packs/packs.json",
        "audit-log.json",
      ]),
    );
    expect(files).not.toContain("packs/pck_2.zip");
    expect(files).not.toContain("evidence/ev_2.raw.json");
  });

  it("archive : manifeste avec l'empreinte de chaque fichier et les décomptes", () => {
    const { zip, counts } = zipExport(input());
    expect(counts).toEqual({
      systems: 1,
      classifications: 1,
      controls: 1,
      evidence: 2,
      attachments: 1,
      packs: 1,
      auditLog: 1,
    });
    const files = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({ format: "prooflayer-org-export", version: 1, counts });
    for (const [path, hash] of Object.entries(manifest.files as Record<string, string>)) {
      expect(createHash("sha256").update(files[path]!).digest("hex"), path).toBe(hash);
    }
    expect(JSON.parse(strFromU8(files["seals/batches.json"]!))).toEqual([
      { seq: 1, merkleRoot: "ab01" },
    ]);
  });
});
