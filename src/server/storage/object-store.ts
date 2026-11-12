// Stockage objet (§4.2 : Supabase Storage, API S3, bucket privé) : charges brutes, pièces jointes, packs, toujours
// chiffrés par organisation avant écriture. Le magasin « local » (fichiers) sert au développement et aux tests ; le
// magasin S3 de Supabase est branché avec le déploiement (PL-108), et le magasin local y est refusé.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { dirname, join, normalize } from "node:path";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { signToken } from "@/server/crypto/signed-token";

export interface ObjectStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /**
   * Adresse de dépôt direct par le navigateur (PUT), valable `expiresInSeconds` (PL-405). Seule la zone d'arrivée
   * `orgs/{orgId}/incoming/` reçoit ainsi un fichier en clair, relu, vérifié, chiffré puis effacé par le serveur.
   */
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
}

export const LOCAL_UPLOAD_PURPOSE = "local-upload";

const KEY = /^[a-z0-9_-]+(\/[A-Za-z0-9._-]+)+$/u;

function checkKey(key: string): string {
  if (!KEY.test(key) || key.includes("..")) throw new Error("clé d'objet invalide");
  return key;
}

export class LocalObjectStore implements ObjectStore {
  constructor(
    private readonly root: string,
    private readonly uploadSecret: string | null = null,
  ) {}

  /** Développement et tests : dépôt par la route /api/uploads/local, autorisé par un jeton signé. */
  async presignPut(key: string, contentType: string, expiresInSeconds: number) {
    if (!this.uploadSecret) throw new Error("dépôt local : secret absent");
    const token = signToken(
      { key: checkKey(key), contentType },
      {
        secret: this.uploadSecret,
        purpose: LOCAL_UPLOAD_PURPOSE,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    );
    return `/api/uploads/local?t=${encodeURIComponent(token)}`;
  }

  private path(key: string) {
    return normalize(join(this.root, checkKey(key)));
  }

  async put(key: string, data: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

/**
 * Supabase Storage par son API S3 (§4.2), bucket privé, accès par clés S3 propres au stockage (jamais la clé de
 * service). Les objets sont déjà chiffrés par organisation avant l'écriture.
 */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: Pick<S3Client, "send">,
    private readonly bucket: string,
  ) {}

  async put(key: string, data: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: checkKey(key),
        Body: data,
        ContentType: "application/octet-stream",
      }),
    );
  }

  async get(key: string) {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }),
      );
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
  }

  async presignPut(key: string, contentType: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.client as S3Client,
      new PutObjectCommand({ Bucket: this.bucket, Key: checkKey(key), ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }
}

export function createObjectStore(
  env: Record<string, string | undefined> = process.env,
): ObjectStore {
  const kind = env.OBJECT_STORE ?? "local";
  if (kind === "local") {
    if (env.VERCEL_ENV === "production") {
      throw new Error("Stockage objet local interdit en production (Supabase Storage : PL-108)");
    }
    return new LocalObjectStore(env.OBJECT_STORE_DIR ?? ".objects", env.BETTER_AUTH_SECRET ?? null);
  }
  if (kind === "s3") {
    const required = [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ] as const;
    const absent = required.filter((name) => !env[name]);
    if (absent.length > 0) throw new Error(`Stockage objet S3 : ${absent.join(", ")} manquant(s)`);
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
    return new S3ObjectStore(client, env.S3_BUCKET!);
  }
  throw new Error(`Stockage objet inconnu : ${kind}`);
}
