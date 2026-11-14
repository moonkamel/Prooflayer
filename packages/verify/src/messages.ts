// Textes de l'outil, en français et en anglais. Le paquet ne dépend pas de l'application : ses textes vivent ici, pas
// dans messages/{fr,en}.json. Jamais le mot « conforme » : l'outil dit ce qui est vérifié, pas ce qui est conforme.
import type { IssueCode, StepId } from "./verify.ts";

export type Lang = "fr" | "en";
type Params = Record<string, string | number>;
type Text = (p: Params) => string;

/** Français : singulier pour 0 et 1. */
const plural = (n: number | string | undefined, one: string, many: string) =>
  Number(n) > 1 ? many : one;
/** Anglais : singulier pour 1 seulement. */
const pluralEn = (n: number | string | undefined, one: string, many: string) =>
  Number(n) === 1 ? one : many;

interface Catalog {
  steps: Record<StepId, string>;
  status: { pass: string; warning: string; fail: string; skipped: string };
  issues: Record<IssueCode, Text>;
  summary: (p: {
    verified: number;
    from: string | null;
    to: string | null;
    alterations: number;
    undisclosed: number;
  }) => string;
  header: (p: { system: string; organization: string; start: string; end: string }) => string;
  signedBy: (kid: string) => string;
  timestamp: (p: { anchor: number; date: string; tsa: string; qualified: boolean }) => string;
  more: (n: number) => string;
  result: { ok: string; okWithWarnings: string; fail: string };
  declarative: (n: number) => string;
  redacted: (n: number) => string;
  usage: string;
  usageError: (detail: string) => string;
  unreadable: (path: string) => string;
}

const fr: Catalog = {
  steps: {
    signature: "Signature du manifeste et intégrité des fichiers",
    evidence: "Preuves divulguées",
    batches: "Lots et chaîne de lots",
    anchors: "Ancres",
    timestamps: "Horodatage RFC 3161",
    census: "Recensement",
  },
  status: { pass: "vérifié", warning: "avertissement", fail: "échec", skipped: "non exécuté" },
  issues: {
    manifest_missing: () => "Archive illisible ou manifest.json absent.",
    manifest_invalid: () => "manifest.json mal formé.",
    unknown_key: ({ kid }) =>
      `Clé de signature « ${kid} » inconnue de l'outil : signature non vérifiable.`,
    bad_signature: ({ kid }) => `Signature du manifeste invalide (clé « ${kid} »).`,
    file_missing: ({ path }) => `Fichier listé mais absent : ${path}.`,
    file_hash: ({ path }) => `Empreinte différente du manifeste : ${path}.`,
    file_unlisted: ({ path }) => `Fichier ajouté, absent du manifeste : ${path}.`,
    evidence_invalid: ({ path }) => `Preuve mal formée : ${path}.`,
    content_hash: ({ id }) => `${id} : la charge ne correspond plus à son empreinte scellée.`,
    attachment_hash: ({ id }) =>
      `${id} : la pièce jointe ne correspond plus à son empreinte scellée.`,
    attachment_missing: ({ id }) => `${id} : pièce jointe annoncée mais absente.`,
    attachment_withheld: ({ id }) => `${id} : pièce jointe scellée mais non jointe au pack.`,
    leaf_mismatch: ({ id, batch }) =>
      `${id} : la feuille recalculée n'est pas celle du lot ${batch}.`,
    leaf_duplicate: ({ id, batch }) =>
      `${id} : place du lot ${batch} déjà occupée par une autre preuve.`,
    batch_missing: ({ id, batch }) => `${id} : lot ${batch} absent du pack.`,
    leaf_index: ({ id, batch }) => `${id} : place inexistante dans le lot ${batch}.`,
    batch_invalid: ({ seq }) => `Lot ${seq} mal formé.`,
    batch_org: ({ seq }) => `Lot ${seq} : organisation différente de celle du pack.`,
    leaf_count: ({ seq }) => `Lot ${seq} : nombre de feuilles différent de l'en-tête.`,
    merkle_root: ({ seq }) => `Lot ${seq} : racine de Merkle différente de l'en-tête.`,
    batch_hash: ({ seq }) => `Lot ${seq} : empreinte de l'en-tête (batchHash) différente.`,
    chain_gap: ({ seq }) => `Chaîne de lots interrompue avant le lot ${seq}.`,
    chain_prev: ({ seq }) =>
      `Lot ${seq} : prevBatchHash différent de l'empreinte du lot précédent.`,
    chain_first: ({ seq }) => `Lot ${seq} : le premier lot ne doit pas avoir de prédécesseur.`,
    anchor_invalid: ({ seq }) => `Ancre ${seq} mal formée.`,
    anchor_missing: ({ batch, anchor }) => `Lot ${batch} : ancre ${anchor} absente du pack.`,
    anchor_order: ({ seq }) => `Ancre ${seq} : empreintes de lots non triées.`,
    anchor_count: ({ seq }) => `Ancre ${seq} : nombre de lots différent de l'en-tête.`,
    anchor_root: ({ seq }) => `Ancre ${seq} : racine de Merkle différente de l'en-tête.`,
    anchor_hash: ({ seq }) => `Ancre ${seq} : empreinte de l'en-tête (anchorHash) différente.`,
    anchor_leaf: ({ batch, anchor }) => `Lot ${batch} : absent de l'ancre ${anchor}.`,
    anchor_chain: ({ seq }) => `Ancre ${seq} : prevAnchorHash différent de l'ancre précédente.`,
    unanchored: ({ count }) =>
      `${count} ${plural(count, "lot n'est", "lots ne sont")} pas encore horodaté${plural(count, "", "s")} par un tiers : leur date n'est attestée que par ProofLayer.`,
    token_missing: ({ seq }) => `Ancre ${seq} : jeton d'horodatage absent.`,
    token_malformed: ({ seq }) => `Ancre ${seq} : jeton d'horodatage illisible.`,
    token_imprint: ({ seq }) => `Ancre ${seq} : le jeton n'horodate pas cette ancre.`,
    token_signature: ({ seq }) => `Ancre ${seq} : signature du jeton invalide.`,
    token_untrusted: ({ seq }) =>
      `Ancre ${seq} : jeton signé par un prestataire que l'outil ne reconnaît pas.`,
    token_usage: ({ seq }) => `Ancre ${seq} : certificat signataire sans usage d'horodatage.`,
    token_time: ({ seq }) => `Ancre ${seq} : date déclarée différente de celle du jeton.`,
    token_policy: ({ seq }) => `Ancre ${seq} : politique déclarée différente de celle du jeton.`,
    sealed_after_token: ({ batch, anchor }) =>
      `Lot ${batch} : scellé après la date du jeton de l'ancre ${anchor}.`,
    tsa_not_qualified: ({ name }) =>
      `Prestataire d'horodatage « ${name} » non qualifié eIDAS (environnement de test).`,
    count_mismatch: ({ field, expected, actual }) =>
      `Recensement « ${field} » : ${actual} constaté, ${expected} annoncé par le manifeste.`,
    control_evidence: ({ control, count }) =>
      `Contrôle ${control} : ${count} ${plural(count, "preuve citée absente", "preuves citées absentes")} du pack.`,
  },
  summary: ({ verified, from, to, alterations, undisclosed }) =>
    [
      `${verified} ${plural(verified, "preuve vérifiée", "preuves vérifiées")}`,
      from && to
        ? from === to
          ? `scellée${plural(verified, "", "s")} le ${from}`
          : `scellée${plural(verified, "", "s")} entre le ${from} et le ${to}`
        : null,
      `${alterations} ${plural(alterations, "altération", "altérations")}`,
      `${undisclosed} ${plural(undisclosed, "preuve de la période non divulguée", "preuves de la période non divulguées")}`,
    ]
      .filter(Boolean)
      .join(", "),
  header: ({ system, organization, start, end }) =>
    `Pack d'audit « ${system} » (${organization}), période du ${start} au ${end}`,
  signedBy: (kid) => `Signé par la clé ${kid}`,
  timestamp: ({ anchor, date, tsa, qualified }) =>
    `Ancre ${anchor} horodatée le ${date} par ${tsa}${qualified ? " (prestataire qualifié)" : ""}`,
  more: (n) => `… et ${n} de plus`,
  result: {
    ok: "Résultat : aucune altération.",
    okWithWarnings: "Résultat : aucune altération, avec des avertissements.",
    fail: "Résultat : ÉCHEC de la vérification.",
  },
  declarative: (n) =>
    `${n} ${plural(n, "preuve déclarative", "preuves déclaratives")} (document déposé ou attestation : le scellement date le dépôt, pas la véracité).`,
  redacted: (n) =>
    `${n} ${plural(n, "preuve effacée", "preuves effacées")} (droit à l'effacement : seule l'empreinte demeure).`,
  usage: `Usage : prooflayer-verify <pack.zip> [options]

Vérifie un pack d'audit ProofLayer hors ligne. Code de sortie 0 : aucune altération ; 1 : échec.

Options :
  --json                  sortie JSON
  --lang fr|en            langue de la sortie (par défaut : celle du pack)
  --strict                les avertissements font aussi échouer la vérification
  --trust-key <kid>=<clé> ajoute une clé publique Ed25519 (base64), par exemple une clé de test
  --trust-tsa <fichier>   ajoute une racine de prestataire d'horodatage (PEM), réputée non qualifiée
  --help                  cette aide
  --version               version de l'outil`,
  usageError: (detail) => `Erreur : ${detail}`,
  unreadable: (path) => `Impossible de lire ${path}.`,
};

const en: Catalog = {
  steps: {
    signature: "Manifest signature and file integrity",
    evidence: "Disclosed evidence",
    batches: "Batches and batch chain",
    anchors: "Anchors",
    timestamps: "RFC 3161 timestamps",
    census: "Census",
  },
  status: { pass: "verified", warning: "warning", fail: "failed", skipped: "not run" },
  issues: {
    manifest_missing: () => "Unreadable archive or missing manifest.json.",
    manifest_invalid: () => "Malformed manifest.json.",
    unknown_key: ({ kid }) =>
      `Signing key "${kid}" unknown to the tool: signature cannot be checked.`,
    bad_signature: ({ kid }) => `Invalid manifest signature (key "${kid}").`,
    file_missing: ({ path }) => `Listed file is missing: ${path}.`,
    file_hash: ({ path }) => `Hash differs from the manifest: ${path}.`,
    file_unlisted: ({ path }) => `Added file, not in the manifest: ${path}.`,
    evidence_invalid: ({ path }) => `Malformed evidence: ${path}.`,
    content_hash: ({ id }) => `${id}: the payload no longer matches its sealed hash.`,
    attachment_hash: ({ id }) => `${id}: the attachment no longer matches its sealed hash.`,
    attachment_missing: ({ id }) => `${id}: attachment announced but missing.`,
    attachment_withheld: ({ id }) => `${id}: attachment sealed but not included in the pack.`,
    leaf_mismatch: ({ id, batch }) =>
      `${id}: the recomputed leaf is not the one in batch ${batch}.`,
    leaf_duplicate: ({ id, batch }) =>
      `${id}: position in batch ${batch} already used by other evidence.`,
    batch_missing: ({ id, batch }) => `${id}: batch ${batch} missing from the pack.`,
    leaf_index: ({ id, batch }) => `${id}: no such position in batch ${batch}.`,
    batch_invalid: ({ seq }) => `Malformed batch ${seq}.`,
    batch_org: ({ seq }) => `Batch ${seq}: organization differs from the pack's.`,
    leaf_count: ({ seq }) => `Batch ${seq}: leaf count differs from the header.`,
    merkle_root: ({ seq }) => `Batch ${seq}: Merkle root differs from the header.`,
    batch_hash: ({ seq }) => `Batch ${seq}: header hash (batchHash) differs.`,
    chain_gap: ({ seq }) => `Batch chain broken before batch ${seq}.`,
    chain_prev: ({ seq }) => `Batch ${seq}: prevBatchHash differs from the previous batch's hash.`,
    chain_first: ({ seq }) => `Batch ${seq}: the first batch must have no predecessor.`,
    anchor_invalid: ({ seq }) => `Malformed anchor ${seq}.`,
    anchor_missing: ({ batch, anchor }) =>
      `Batch ${batch}: anchor ${anchor} missing from the pack.`,
    anchor_order: ({ seq }) => `Anchor ${seq}: batch hashes not sorted.`,
    anchor_count: ({ seq }) => `Anchor ${seq}: batch count differs from the header.`,
    anchor_root: ({ seq }) => `Anchor ${seq}: Merkle root differs from the header.`,
    anchor_hash: ({ seq }) => `Anchor ${seq}: header hash (anchorHash) differs.`,
    anchor_leaf: ({ batch, anchor }) => `Batch ${batch}: not in anchor ${anchor}.`,
    anchor_chain: ({ seq }) => `Anchor ${seq}: prevAnchorHash differs from the previous anchor.`,
    unanchored: ({ count }) =>
      `${count} ${pluralEn(count, "batch is", "batches are")} not yet timestamped by a third party: ${pluralEn(count, "its", "their")} date is attested by ProofLayer only.`,
    token_missing: ({ seq }) => `Anchor ${seq}: timestamp token missing.`,
    token_malformed: ({ seq }) => `Anchor ${seq}: unreadable timestamp token.`,
    token_imprint: ({ seq }) => `Anchor ${seq}: the token does not timestamp this anchor.`,
    token_signature: ({ seq }) => `Anchor ${seq}: invalid token signature.`,
    token_untrusted: ({ seq }) =>
      `Anchor ${seq}: token signed by a provider the tool does not recognize.`,
    token_usage: ({ seq }) => `Anchor ${seq}: signer certificate lacks the timestamping usage.`,
    token_time: ({ seq }) => `Anchor ${seq}: declared date differs from the token's.`,
    token_policy: ({ seq }) => `Anchor ${seq}: declared policy differs from the token's.`,
    sealed_after_token: ({ batch, anchor }) =>
      `Batch ${batch}: sealed after the date of anchor ${anchor}'s token.`,
    tsa_not_qualified: ({ name }) =>
      `Timestamp provider "${name}" is not eIDAS-qualified (test environment).`,
    count_mismatch: ({ field, expected, actual }) =>
      `Census "${field}": ${actual} found, ${expected} stated by the manifest.`,
    control_evidence: ({ control, count }) =>
      `Control ${control}: ${count} cited evidence ${pluralEn(count, "item", "items")} missing from the pack.`,
  },
  summary: ({ verified, from, to, alterations, undisclosed }) =>
    [
      `${verified} evidence ${pluralEn(verified, "item", "items")} verified`,
      from && to ? (from === to ? `sealed on ${from}` : `sealed between ${from} and ${to}`) : null,
      `${alterations} ${pluralEn(alterations, "alteration", "alterations")}`,
      `${undisclosed} evidence ${pluralEn(undisclosed, "item", "items")} from the period not disclosed`,
    ]
      .filter(Boolean)
      .join(", "),
  header: ({ system, organization, start, end }) =>
    `Audit pack "${system}" (${organization}), period ${start} to ${end}`,
  signedBy: (kid) => `Signed with key ${kid}`,
  timestamp: ({ anchor, date, tsa, qualified }) =>
    `Anchor ${anchor} timestamped on ${date} by ${tsa}${qualified ? " (qualified provider)" : ""}`,
  more: (n) => `… and ${n} more`,
  result: {
    ok: "Result: no alteration.",
    okWithWarnings: "Result: no alteration, with warnings.",
    fail: "Result: verification FAILED.",
  },
  declarative: (n) =>
    `${n} declarative evidence ${pluralEn(n, "item", "items")} (uploaded document or attestation: sealing dates the upload, not its truth).`,
  redacted: (n) =>
    `${n} erased evidence ${pluralEn(n, "item", "items")} (right to erasure: only the hash remains).`,
  usage: `Usage: prooflayer-verify <pack.zip> [options]

Verifies a ProofLayer audit pack offline. Exit code 0: no alteration; 1: failure.

Options:
  --json                  JSON output
  --lang fr|en            output language (default: the pack's)
  --strict                warnings also fail the verification
  --trust-key <kid>=<key> adds an Ed25519 public key (base64), e.g. a test key
  --trust-tsa <file>      adds a timestamp provider root (PEM), considered non-qualified
  --help                  this help
  --version               tool version`,
  usageError: (detail) => `Error: ${detail}`,
  unreadable: (path) => `Cannot read ${path}.`,
};

export const MESSAGES: Record<Lang, Catalog> = { fr, en };
