// Dépôt local (développement et tests, PL-405) : remplace l'adresse signée S3 quand le stockage objet est « local ».
// Jeton signé (clé, type), taille bornée ; refusé en production et avec tout autre stockage.
import { verifyToken } from "@/server/crypto/signed-token";
import { createObjectStore, LOCAL_UPLOAD_PURPOSE } from "@/server/storage/object-store";
import { MAX_UPLOAD_BYTES } from "@/server/services/manual-evidence";

export async function acceptLocalUpload(
  token: string | null,
  contentType: string | null,
  body: Uint8Array,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  if ((env.OBJECT_STORE ?? "local") !== "local" || env.VERCEL_ENV === "production") return 404;
  if (!token || !env.BETTER_AUTH_SECRET) return 403;
  const claims = verifyToken(token, {
    secret: env.BETTER_AUTH_SECRET,
    purpose: LOCAL_UPLOAD_PURPOSE,
    now: new Date(),
  }) as { key?: string; contentType?: string } | null;
  if (!claims?.key || claims.contentType !== contentType) return 403;
  if (body.length > MAX_UPLOAD_BYTES) return 413;
  await createObjectStore(env).put(claims.key, body);
  return 200;
}
