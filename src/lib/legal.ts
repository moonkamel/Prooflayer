// PL-606 — Pages légales et centre de confiance (§8.2, §8.3), fonctions pures.
// L'identité de l'éditeur n'est jamais inventée : elle est lue en configuration (variables LEGAL_*, non secrètes) ;
// un champ absent reste visible comme tel dans les pages, qui signalent alors qu'elles sont incomplètes.

/** Version des documents contractuels : toute modification de fond publie une nouvelle version datée. */
export const LEGAL_VERSION = "2026-11-15";

export const LEGAL_DOCUMENTS = ["terms", "dpa", "privacy", "notice"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];
export const isLegalDocument = (value: string): value is LegalDocument =>
  (LEGAL_DOCUMENTS as readonly string[]).includes(value);

/** Mentions de l'éditeur (LCEN art. 6-III, C. com. art. R123-237) et variable qui porte chacune. */
export const LEGAL_FIELDS = {
  company: "LEGAL_COMPANY_NAME",
  form: "LEGAL_COMPANY_FORM",
  capital: "LEGAL_SHARE_CAPITAL",
  registration: "LEGAL_RCS",
  vat: "LEGAL_VAT_NUMBER",
  address: "LEGAL_ADDRESS",
  director: "LEGAL_PUBLICATION_DIRECTOR",
  contact: "LEGAL_CONTACT_EMAIL",
  security: "LEGAL_SECURITY_EMAIL",
  privacy: "LEGAL_PRIVACY_EMAIL",
  court: "LEGAL_COURT",
  hostAddress: "LEGAL_HOST_ADDRESS",
} as const;
export type LegalField = keyof typeof LEGAL_FIELDS;

export interface LegalEntity {
  values: Record<LegalField, string | null>;
  missing: LegalField[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const EMAIL_FIELDS: readonly LegalField[] = ["contact", "security", "privacy"];

export function legalEntity(env: Record<string, string | undefined>): LegalEntity {
  const values = {} as Record<LegalField, string | null>;
  const missing: LegalField[] = [];
  for (const [field, variable] of Object.entries(LEGAL_FIELDS) as [LegalField, string][]) {
    const raw = env[variable]?.trim() ?? "";
    const valid = raw !== "" && (!EMAIL_FIELDS.includes(field) || EMAIL.test(raw));
    values[field] = valid ? raw : null;
    if (!valid) missing.push(field);
  }
  // Adresses de repli : sécurité et confidentialité vont au contact général si elles ne sont pas fixées.
  for (const field of ["security", "privacy"] as const) {
    if (!values[field] && values.contact) {
      values[field] = values.contact;
      missing.splice(missing.indexOf(field), 1);
    }
  }
  return { values, missing };
}

/** Remplace les marqueurs `{champ}` d'un texte ; un champ absent devient le libellé fourni (« [à compléter] »). */
export function fillLegal(
  text: string,
  values: Record<string, string | null>,
  placeholder: string,
): string {
  return text.replace(/\{(\w+)\}/gu, (whole, key: string) =>
    key in values ? (values[key] ?? placeholder) : whole,
  );
}

/** Sous-traitants ultérieurs (§8.2). L'emailing est assuré par Brevo (PL-108), repli européen prévu par le §8.2. */
export const SUBPROCESSORS = [
  { id: "supabase", name: "Supabase", since: "PL-102" },
  { id: "vercel", name: "Vercel", since: "PL-108" },
  { id: "stripe", name: "Stripe", since: "PL-601" },
  { id: "brevo", name: "Brevo (Sendinblue SAS)", since: "PL-108" },
  { id: "sentry", name: "Sentry (Functional Software, Inc.)", since: "PL-108" },
  { id: "posthog", name: "PostHog", since: "PL-608" },
] as const;
export type SubprocessorId = (typeof SUBPROCESSORS)[number]["id"];

/** Durée de validité annoncée par security.txt (RFC 9116 §2.5.5 : moins d'un an recommandé). */
export const SECURITY_TXT_DAYS = 180;

/** Contenu de /.well-known/security.txt (RFC 9116) ; null sans adresse de contact. */
export function securityTxt(input: {
  contact: string | null;
  origin: string;
  now: Date;
}): string | null {
  if (!input.contact) return null;
  const origin = input.origin.replace(/\/+$/u, "");
  const expires = new Date(input.now.getTime() + SECURITY_TXT_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: mailto:${input.contact}`,
    `Expires: ${expires.toISOString().replace(".000Z", "Z")}`,
    "Preferred-Languages: fr, en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/trust#disclosure`,
    "",
  ].join("\n");
}
