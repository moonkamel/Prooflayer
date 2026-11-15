// PL-606 — Pack d'audit de ProofLayer sur lui-même, public (§8.1 « Mise en pratique », §8.3 centre de confiance).
// Le pack publié est désigné en configuration (PUBLIC_PACK_ORG_ID, PUBLIC_PACK_ID) : le fondateur l'a produit dans
// l'organisation ProofLayer, depuis le registre, comme tout client. Seul un pack prêt est servi ; rien d'autre de
// l'organisation n'est lisible par cette voie.
import { withOrgTransaction } from "@/server/db";
import type { ObjectStore } from "@/server/storage/object-store";
import { packStorage, readPackArchive } from "./packs";

export interface PublicPackConfig {
  orgId: string;
  packId: string;
}

export function publicPackConfig(env: Record<string, string | undefined> = process.env) {
  const orgId = env.PUBLIC_PACK_ORG_ID?.trim();
  const packId = env.PUBLIC_PACK_ID?.trim();
  return orgId && packId ? { orgId, packId } : null;
}

async function readyPack(config: PublicPackConfig) {
  const pack = await withOrgTransaction(config.orgId, (tx) =>
    tx.auditPack.findFirst({
      where: { id: config.packId, orgId: config.orgId, status: "READY" },
      select: {
        id: true,
        objectKey: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        evidenceCount: true,
        signingKid: true,
        manifestSha256: true,
        system: { select: { name: true, slug: true } },
      },
    }),
  );
  return pack?.objectKey ? pack : null;
}

/** Description affichée par le centre de confiance ; null si aucun pack public n'est prêt. */
export async function publicPackSummary(config = publicPackConfig()) {
  if (!config) return null;
  const pack = await readyPack(config);
  if (!pack) return null;
  return {
    systemName: pack.system.name,
    periodStart: pack.periodStart,
    periodEnd: pack.periodEnd,
    createdAt: pack.createdAt,
    evidenceCount: pack.evidenceCount,
    signingKid: pack.signingKid,
    manifestSha256: pack.manifestSha256 ? Buffer.from(pack.manifestSha256).toString("hex") : null,
  };
}

/** Contenu de l'archive pour la route publique ; null si aucun pack public n'est prêt. */
export async function publicPackArchive(
  config = publicPackConfig(),
  store: ObjectStore = packStorage.store(),
) {
  if (!config) return null;
  const pack = await readyPack(config);
  if (!pack?.objectKey) return null;
  const bytes = await readPackArchive(
    config.orgId,
    { id: pack.id, objectKey: pack.objectKey },
    store,
  );
  if (!bytes) return null;
  return { bytes, filename: `prooflayer-pack-${pack.system.slug}.zip` };
}
