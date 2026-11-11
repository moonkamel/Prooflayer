// Export CSV (RFC 4180), protégé contre l'injection de formules dans les tableurs (OWASP « CSV Injection ») :
// une cellule qui commence par = + - @ tabulation ou retour chariot est préfixée d'une apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/u;

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) || safe !== text ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** Fichier CSV complet : ligne d'en-tête, puis une ligne par enregistrement, fins de ligne CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
