// Revue finale — Archives au repos (packs d'audit, exports complets) chiffrées par la clé de données de
// l'organisation, comme les charges brutes et les pièces jointes : détruire la clé (purge, PL-607) les rend illisibles,
// sauvegardes comprises. Un objet écrit avant ce chiffrement (archive ZIP en clair, premier octet « P ») se lit tel quel.
import { decrypt, encrypt } from "@/server/crypto/envelope";

const SEALED_VERSION = 0x01;

export const packAad = (orgId: string, packId: string) => `pack:${orgId}:${packId}`;
export const exportAad = (orgId: string, exportId: string) => `export:${orgId}:${exportId}`;

export function sealArchive(dek: Uint8Array, archive: Uint8Array, aad: string): Buffer {
  return encrypt(dek, archive, aad);
}

/** Archive en clair ; la clé n'est demandée que si l'objet est chiffré. */
export async function openArchive(
  stored: Uint8Array,
  aad: string,
  dek: () => Promise<Uint8Array>,
): Promise<Buffer> {
  if (stored[0] !== SEALED_VERSION) return Buffer.from(stored);
  return decrypt(await dek(), stored, aad);
}
