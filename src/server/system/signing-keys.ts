// Clés publiques de signature des packs (PL-504) : table système `SigningKey`, sans organisation. La clé de
// développement (`pl-dev`) n'est jamais publiée en production.
import { prisma } from "@/server/db";
import { DEV_KID } from "@/server/pack/signing";

export async function publishedSigningKeys(env: Record<string, string | undefined> = process.env) {
  const keys = await prisma.signingKey.findMany({ orderBy: { createdAt: "asc" } });
  return keys
    .filter((k) => !(env.VERCEL_ENV === "production" && k.kid === DEV_KID))
    .map((k) => ({
      kid: k.kid,
      alg: k.algorithm,
      /** Clé publique Ed25519 brute (32 octets), en base64. */
      publicKey: Buffer.from(k.publicKey).toString("base64"),
      createdAt: k.createdAt.toISOString(),
      retiredAt: k.retiredAt?.toISOString() ?? null,
    }));
}
