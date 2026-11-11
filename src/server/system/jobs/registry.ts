// Registre typé des gestionnaires de jobs (PL-107). Un type de job = un schéma Zod de sa charge + un gestionnaire.
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

export interface JobContext {
  /**
   * Transaction dans laquelle le job sera marqué terminé. Toute écriture en base du gestionnaire passe par elle :
   * l'effet et la fin du job sont validés ensemble, ou pas du tout (§4.3.3, PL-107).
   * Si le job porte un orgId, app.org_id y est déjà positionné : RLS s'applique aux tables métier.
   */
  tx: Prisma.TransactionClient;
  job: { id: string; type: string; orgId: string | null; attempts: number };
}

export interface JobDefinition<P> {
  /** Identifiant stable, par exemple « github.backfill », « control.evaluate » (§4.3.2). */
  type: string;
  schema: z.ZodType<P>;
  /**
   * Doit être idempotent pour tout effet hors base (appel réseau, email) : une tentative interrompue avant la
   * validation de sa transaction est rejouée. Les écritures en base, elles, ne sont validées qu'une fois.
   */
  handle: (payload: P, ctx: JobContext) => Promise<void>;
  /** Tentatives au plus ; 8 par défaut (§4.5.3). */
  maxAttempts?: number;
  /** Durée maximale d'une tentative, transaction comprise ; 60 s par défaut. */
  timeoutMs?: number;
}

export function defineJob<P>(definition: JobDefinition<P>): JobDefinition<P> {
  return definition;
}

export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition<unknown>>();

  constructor(definitions: JobDefinition<never>[] = []) {
    for (const d of definitions) this.register(d);
  }

  register<P>(definition: JobDefinition<P>): this {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Type de job déjà enregistré : ${definition.type}`);
    }
    this.definitions.set(definition.type, definition as JobDefinition<unknown>);
    return this;
  }

  get(type: string): JobDefinition<unknown> | undefined {
    return this.definitions.get(type);
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }
}
