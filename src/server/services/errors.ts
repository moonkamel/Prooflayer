// Erreur métier levée par les services. `reason` est une clé stable, traduite par l'interface.
export type ServiceErrorCode =
  "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "TOO_MANY_REQUESTS";

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "ServiceError";
  }
}
