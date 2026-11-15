// Stockage objet (§4.2 : Supabase Storage, API S3, bucket privé) : charges brutes, pièces jointes, packs, toujours
// chiffrés par organisation avant écriture. Le magasin « local » (fichiers) sert au développement et aux tests ; le
// magasin S3 de Supabase est branché avec le déploiement (PL-108), et le magasin local y est refusé.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  /** Supprime tous les objets sous un préfixe `orgs/{orgId}/` (purge d'une organisation, PL-607) ; idempotent. */
  deletePrefix(prefix: string): Promise<number>;
  /** Taille d'un objet en octets, sans le lire ; null s'il est absent (revue finale : dépôt borné avant lecture). */
  size(key: string): Promise<number | null>;
  /** Supprime, sous la zone d'arrivée `orgs/{orgId}/incoming/`, les objets plus anciens que `cutoff`. */
  deleteOlderThan(prefix: string, cutoff: Date): Promise<number>;
  /**
   * Adresse de dépôt direct par le navigateur (PUT), valable `expiresInSeconds` (PL-405). Seule la zone d'arrivée
   * `orgs/{orgId}/incoming/` reçoit ainsi un fichier en clair, relu, vérifié, chiffré puis effacé par le serveur.
   */
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
}

export const LOCAL_UPLOAD_PURPOSE = "local-upload";

const KEY = /^[a-z0-9_-]+(\/[A-Za-z0-9._-]+)+$/u;

/** Préfixe d'une organisation seulement : jamais la racine du stockage. */
function checkPrefix(prefix: string): string {
  if (!/^orgs\/[A-Za-z0-9_-]+\/$/u.test(prefix)) throw new Error("préfixe d'objet invalide");
  return prefix;
}

/** Zone d'arrivée d'une organisation seulement. */
function checkIncomingPrefix(prefix: string): string {
  if (!/^orgs\/[A-Za-z0-9_-]+\/incoming\/$/u.test(prefix))
    throw new Error("préfixe d'objet invalide");
  return prefix;
}

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

  async size(key: string) {
    try {
      return (await stat(this.path(key))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteOlderThan(prefix: string, cutoff: Date) {
    const dir = normalize(join(this.root, checkIncomingPrefix(prefix)));
    const names = await readdir(dir).catch(() => [] as string[]);
    let removed = 0;
    for (const name of names) {
      const file = join(dir, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && info.mtime < cutoff) {
        await rm(file, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  async deletePrefix(prefix: string) {
    const dir = normalize(join(this.root, checkPrefix(prefix)));
    const existed = await readdir(dir, { recursive: true }).then(
      (entries) => entries.length,
      () => 0,
    );
    await rm(dir, { recursive: true, force: true });
    return existed;
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

  async size(key: string) {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }),
      );
      return out.ContentLength ?? null;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") return null;
      throw error;
    }
  }

  async deleteOlderThan(prefix: string, cutoff: Date) {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: checkIncomingPrefix(prefix),
          ContinuationToken: token,
        }),
      );
      const keys = (page.Contents ?? []).flatMap((o) =>
        o.Key && o.LastModified && o.LastModified < cutoff ? [{ Key: o.Key }] : [],
      );
      if (keys.length) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  async deletePrefix(prefix: string) {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: checkPrefix(prefix),
          ContinuationToken: token,
        }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
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
