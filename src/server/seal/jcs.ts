// Canonicalisation JSON selon la RFC 8785 (JCS), §4.6.2 étape 1. Fonction pure.
// Clés triées par unités de code UTF-16 ; nombres sérialisés comme ECMAScript (Number.prototype.toString, ce que fait
// JSON.stringify) ; chaînes échappées comme JSON.stringify ; aucun espace. Toute valeur que JSON ne représente pas
// (NaN, Infinity, undefined, fonction, BigInt, Date, objet non simple) est refusée plutôt que convertie en silence.
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("JCS : nombre non fini");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError("JCS : seuls les objets JSON simples sont acceptés");
      }
      const keys = Object.keys(value).sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`JCS : type non représentable (${typeof value})`);
  }
}
