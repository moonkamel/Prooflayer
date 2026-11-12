// Bibliothèque de contrôles v1 (PL-206, §3.2 E6, §12.3) : un fichier par pack, validé par schéma au chargement.
// Une évolution du référentiel publie une nouvelle version ; `pnpm controls:sync` la reporte dans `ControlDefinition`.
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import { PACK_A } from "./pack-a";
import { PACK_B } from "./pack-b";
import { PACK_C } from "./pack-c";
import { ROLES, TIERS, controlSchema, type Control } from "./schema";

export const LIBRARY_VERSION = "2026.11.0";

export const CONTROL_LIBRARY: readonly Control[] = [...PACK_A, ...PACK_B, ...PACK_C].map((c) =>
  controlSchema.parse(c),
);

/** Contrôles qui s'appliquent à un système selon sa catégorie et son rôle (§9.4, PL-207). */
export function applicableControls(tier: RiskTier, role: AiActRole): Control[] {
  return CONTROL_LIBRARY.filter(
    (c) =>
      (c.appliesToTiers as readonly string[]).includes(tier) &&
      (c.appliesToRoles as readonly string[]).includes(role),
  );
}

export { ROLES, TIERS, type Control };
