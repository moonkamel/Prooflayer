// Contenu d'un pack d'audit (PL-504, §3.2 E9, §4.6.2 étape 4). Fonctions pures : à partir des données lues en base,
// les fichiers de l'archive et le manifeste (non signé). C'est le format que l'outil de vérification (PL-505) relit :
//
//   manifest.json              identité, période, décomptes, empreinte SHA-256 de chaque autre fichier, signature
//   report.pdf                 rapport lisible par un non-technicien (rendu à part)
//   controls.json              tous les contrôles du système, statut, preuves, dernière évaluation (jamais filtrés)
//   evidence/<id>.json         une preuve divulguée : charge, sel, enveloppe, place dans son lot
//   evidence/<id>.<ext>        sa pièce jointe en clair, s'il y en a une
//   proofs/batches/<seq>.json  un lot de la période : en-tête, batchHash, TOUTES ses feuilles (divulguées ou non)
//   proofs/anchors/<seq>.json  une ancre : en-tête, anchorHash, ses feuilles (batchHash), prestataire
//   proofs/anchors/<seq>.tst   son jeton RFC 3161 (TimeStampToken DER)
//   proofs/tsa/<nom>.pem       racine du prestataire, pour `openssl ts -verify` (l'outil épingle les siennes)
//   VERIFY.md                  la vérification pas à pas, sans notre outil
//   templates/annex-iv.md      gabarit de documentation technique, prérempli (PL-506)
//   templates/eu-declaration.md gabarit de déclaration UE (PL-506)
//
// Divulgation : chaque lot du pack liste toutes ses feuilles ; une preuve non divulguée n'y figure que par son
// leafHash, une omission est donc visible (§3.2 E9). Encodage : hexadécimal minuscule, dates ISO 8601 UTC.
import { createHash } from "node:crypto";
import type { AnchorHeader } from "@/server/seal/anchor";
import type { BatchHeader } from "@/server/seal/batch";

export const PACK_VERSION = 1;
export const PACK_TYPE = "prooflayer.pack";

const enc = new TextEncoder();
const json = (value: unknown) => enc.encode(`${JSON.stringify(value, null, 2)}\n`);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString("hex") : null);

/** Extension d'une pièce jointe, d'après son type MIME (liste du dépôt manuel, PL-405). */
const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/markdown": "md",
  "text/csv": "csv",
};

export interface PackEvidence {
  id: string;
  kind: string;
  source: string;
  capturedVia: string;
  sourceRef: string;
  sourceUrl: string | null;
  occurredAt: Date;
  capturedAt: Date;
  summary: string;
  declarative: boolean;
  validUntil: Date | null;
  redactedAt: Date | null;
  payload: unknown;
  salt: Uint8Array | null;
  contentSha256: Uint8Array;
  attachmentSha256: Uint8Array | null;
  attachmentMime: string | null;
  /** Pièce jointe déchiffrée, si elle existe encore. */
  attachment: Uint8Array | null;
  batchSeq: number;
  leafIndex: number;
}

export interface PackBatch {
  header: BatchHeader;
  batchHash: Uint8Array;
  leafHashes: readonly Uint8Array[];
  anchor: { seq: number; leafIndex: number } | null;
}

export interface PackAnchor {
  header: AnchorHeader;
  anchorHash: Uint8Array;
  batchHashes: readonly Uint8Array[];
  tsa: { name: string; policyOid: string; genTime: Date };
  token: Uint8Array;
}

export interface PackControl {
  key: string;
  articleRef: string;
  title: { fr: string; en: string };
  automation: string;
  status: string;
  notApplicable: boolean;
  justification: string | null;
  evidenceIds: string[];
  lastEvaluation: {
    at: string;
    status: string;
    evaluatorVersion: string;
    reasons: { code: string; message: { fr: string; en: string } }[];
  } | null;
}

export interface PackInput {
  packId: string;
  generatedAt: Date;
  language: "fr" | "en";
  organization: { id: string; name: string };
  system: { id: string; name: string };
  period: { start: string; end: string };
  libraryVersion: string;
  controls: PackControl[];
  evidence: PackEvidence[];
  batches: PackBatch[];
  anchors: PackAnchor[];
  /** Racines des prestataires d'horodatage, par nom de fichier (`proofs/tsa/<nom>.pem`). */
  tsaRoots: Record<string, string>;
  report: Uint8Array;
  verifyMd: string;
  /** Gabarits Annexe IV et Annexe V (PL-506), en Markdown. */
  templates?: { annexIv: string; annexV: string };
}

export const evidencePath = (id: string) => `evidence/${id}.json`;
export const batchPath = (seq: number) => `proofs/batches/${seq}.json`;
export const anchorPath = (seq: number) => `proofs/anchors/${seq}.json`;
export const tokenPath = (seq: number) => `proofs/anchors/${seq}.tst`;

function evidenceDocument(e: PackEvidence, attachmentPath: string | null) {
  return {
    v: PACK_VERSION,
    id: e.id,
    kind: e.kind,
    source: e.source,
    capturedVia: e.capturedVia,
    sourceRef: e.sourceRef,
    sourceUrl: e.sourceUrl,
    occurredAt: e.occurredAt.toISOString(),
    capturedAt: e.capturedAt.toISOString(),
    summary: e.summary,
    /** Preuve manuelle ou attestation : déclarative (§5.2), jamais présentée comme capturée. */
    declarative: e.declarative,
    validUntil: e.validUntil?.toISOString() ?? null,
    /** Effacée (droit à l'effacement) : ni charge ni sel, seul le leafHash du lot demeure (§4.6.5). */
    redacted: e.redactedAt !== null,
    payload: e.redactedAt ? null : (e.payload ?? null),
    salt: e.redactedAt ? null : hex(e.salt),
    contentSha256: hex(e.contentSha256),
    attachmentSha256: hex(e.attachmentSha256),
    attachment:
      attachmentPath && e.attachmentMime ? { path: attachmentPath, mime: e.attachmentMime } : null,
    seal: { batch: e.batchSeq, leafIndex: e.leafIndex },
  };
}

export interface PackManifest extends Record<string, unknown> {
  v: number;
  type: string;
  packId: string;
  generatedAt: string;
  language: string;
  organization: { id: string; name: string };
  system: { id: string; name: string };
  period: { start: string; end: string };
  libraryVersion: string;
  counts: {
    controls: number;
    failing: number;
    missing: number;
    disclosed: number;
    leaves: number;
    undisclosed: number;
    batches: number;
    anchors: number;
    unanchoredBatches: number;
  };
  files: { path: string; sha256: string; size: number }[];
}

/** Fichiers de l'archive (hors manifest.json) et manifeste non signé. */
export function buildPackFiles(input: PackInput): {
  files: Map<string, Uint8Array>;
  manifest: PackManifest;
} {
  const files = new Map<string, Uint8Array>();
  files.set("report.pdf", input.report);
  files.set("VERIFY.md", enc.encode(input.verifyMd));
  files.set("controls.json", json(input.controls));
  if (input.templates) {
    files.set("templates/annex-iv.md", enc.encode(input.templates.annexIv));
    files.set("templates/eu-declaration.md", enc.encode(input.templates.annexV));
  }
  for (const e of input.evidence) {
    const ext = e.attachmentMime ? EXTENSIONS[e.attachmentMime] : undefined;
    const attachmentPath = e.attachment && ext && !e.redactedAt ? `evidence/${e.id}.${ext}` : null;
    if (attachmentPath) files.set(attachmentPath, e.attachment!);
    files.set(evidencePath(e.id), json(evidenceDocument(e, attachmentPath)));
  }
  for (const b of input.batches) {
    files.set(
      batchPath(b.header.seq),
      json({
        header: b.header,
        batchHash: hex(b.batchHash),
        leafHashes: b.leafHashes.map((l) => hex(l)),
        anchor: b.anchor,
      }),
    );
  }
  for (const a of input.anchors) {
    files.set(tokenPath(a.header.seq), a.token);
    files.set(
      anchorPath(a.header.seq),
      json({
        header: a.header,
        anchorHash: hex(a.anchorHash),
        batchHashes: a.batchHashes.map((h) => hex(h)),
        tsa: { ...a.tsa, genTime: a.tsa.genTime.toISOString() },
        token: tokenPath(a.header.seq),
      }),
    );
  }
  for (const [name, pem] of Object.entries(input.tsaRoots)) {
    files.set(`proofs/tsa/${name}.pem`, enc.encode(pem));
  }
  const leaves = input.batches.reduce((n, b) => n + b.leafHashes.length, 0);
  const disclosed = input.evidence.filter((e) => !e.redactedAt).length;
  const manifest: PackManifest = {
    v: PACK_VERSION,
    type: PACK_TYPE,
    packId: input.packId,
    generatedAt: input.generatedAt.toISOString(),
    language: input.language,
    organization: input.organization,
    system: input.system,
    period: input.period,
    libraryVersion: input.libraryVersion,
    counts: {
      controls: input.controls.length,
      failing: input.controls.filter((c) => !c.notApplicable && c.status === "FAIL").length,
      missing: input.controls.filter((c) => !c.notApplicable && c.status === "MISSING").length,
      disclosed,
      leaves,
      undisclosed: leaves - disclosed,
      batches: input.batches.length,
      anchors: input.anchors.length,
      unanchoredBatches: input.batches.filter((b) => !b.anchor).length,
    },
    files: [...files.entries()]
      .map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return { files, manifest };
}
