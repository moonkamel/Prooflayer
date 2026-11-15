// PL-605 — Forme des erreurs renvoyées au client (pure).
/**
 * PL-605 (ASVS 7.4.1) : une erreur interne ne renvoie jamais son message ni sa pile au client ; les erreurs métier
 * (`ServiceError`, traduites en codes tRPC) et de validation gardent leur clé stable.
 */
export function safeErrorShape<S extends { message: string; data: Record<string, unknown> }>(
  shape: S,
  code: string,
): S {
  const { stack: _stack, ...data } = shape.data;
  void _stack;
  if (code === "INTERNAL_SERVER_ERROR") return { ...shape, message: "internal_error", data };
  return { ...shape, data };
}
