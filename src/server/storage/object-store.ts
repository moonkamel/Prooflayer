// Stockage objet (§4.2 : Supabase Storage, API S3, bucket privé) : charges brutes, pièces jointes, packs, toujours
// chiffrés par organisation avant écriture. Le magasin « local » (fichiers) sert au développement et aux tests ; le
// magasin S3 de Supabase est branché avec le déploiement (PL-108), et le magasin local y est refusé.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface ObjectStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-z0-9_-]+(\/[A-Za-z0-9._-]+)+$/u;

function checkKey(key: string): string {
  if (!KEY.test(key) || key.includes("..")) throw new Error("clé d'objet invalide");
  return key;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

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

export function createObjectStore(
  env: Record<string, string | undefined> = process.env,
): ObjectStore {
  const kind = env.OBJECT_STORE ?? "local";
  if (kind === "local") {
    if (env.VERCEL_ENV === "production") {
      throw new Error("Stockage objet local interdit en production (Supabase Storage : PL-108)");
    }
    return new LocalObjectStore(env.OBJECT_STORE_DIR ?? ".objects");
  }
  throw new Error(`Stockage objet inconnu : ${kind}`);
}
