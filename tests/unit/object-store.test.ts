// PL-108 — Stockage objet : configuration S3 (Supabase Storage), clés validées, objet absent → null.
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createObjectStore, S3ObjectStore } from "@/server/storage/object-store";

const s3Env = {
  OBJECT_STORE: "s3",
  S3_ENDPOINT: "https://ref.storage.supabase.co/storage/v1/s3",
  S3_REGION: "eu-central-1",
  S3_BUCKET: "prooflayer",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("createObjectStore", () => {
  it("S3 : toutes les variables sont exigées, sans en afficher la valeur", () => {
    expect(createObjectStore(s3Env)).toBeInstanceOf(S3ObjectStore);
    const { S3_SECRET_ACCESS_KEY: _omit, ...partial } = s3Env;
    void _omit;
    expect(() => createObjectStore(partial)).toThrow("S3_SECRET_ACCESS_KEY manquant(s)");
  });

  it("local refusé en production, type inconnu refusé", () => {
    expect(() => createObjectStore({ OBJECT_STORE: "local", VERCEL_ENV: "production" })).toThrow();
    expect(() => createObjectStore({ OBJECT_STORE: "ftp" })).toThrow("Stockage objet inconnu");
  });
});

describe("S3ObjectStore", () => {
  it("écrit dans le bucket, relit, et rend null pour un objet absent", async () => {
    const objects = new Map<string, Uint8Array>();
    const client = {
      send: async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          expect(command.input.Bucket).toBe("prooflayer");
          objects.set(command.input.Key!, command.input.Body as Uint8Array);
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const data = objects.get(command.input.Key!);
          if (!data) throw Object.assign(new Error("absent"), { name: "NoSuchKey" });
          return { Body: { transformToByteArray: async () => data } };
        }
        objects.clear();
        return {};
      },
    };
    const store = new S3ObjectStore(client as never, "prooflayer");
    await store.put("orgs/org_1/raw/ev_1.bin", Buffer.from("chiffré"));
    expect((await store.get("orgs/org_1/raw/ev_1.bin"))?.toString()).toBe("chiffré");
    expect(await store.get("orgs/org_1/raw/ev_2.bin")).toBeNull();
    await expect(store.put("../evasion", Buffer.from("x"))).rejects.toThrow("clé d'objet invalide");
    await store.delete("orgs/org_1/raw/ev_1.bin");
    expect(await store.get("orgs/org_1/raw/ev_1.bin")).toBeNull();
  });
});

describe("suppression d'un préfixe d'organisation (PL-607)", () => {
  it("S3 : pages de liste suivies jusqu'au bout, objets supprimés par lots", async () => {
    const { DeleteObjectsCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const deleted: string[] = [];
    const pages = [
      {
        Contents: [{ Key: "orgs/org_1/raw/a.bin" }, { Key: "orgs/org_1/packs/p.zip" }],
        IsTruncated: true,
        NextContinuationToken: "t2",
      },
      { Contents: [{ Key: "orgs/org_1/exports/e.zip" }], IsTruncated: false },
    ];
    const client = {
      send: async (command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          expect(command.input.Prefix).toBe("orgs/org_1/");
          return pages[command.input.ContinuationToken === "t2" ? 1 : 0];
        }
        if (command instanceof DeleteObjectsCommand) {
          deleted.push(...command.input.Delete!.Objects!.map((o) => o.Key!));
          return {};
        }
        throw new Error("commande inattendue");
      },
    };
    const store = new S3ObjectStore(client as never, "prooflayer");
    expect(await store.deletePrefix("orgs/org_1/")).toBe(3);
    expect(deleted).toEqual([
      "orgs/org_1/raw/a.bin",
      "orgs/org_1/packs/p.zip",
      "orgs/org_1/exports/e.zip",
    ]);
  });

  it("jamais la racine ni un autre préfixe", async () => {
    const store = new S3ObjectStore({ send: async () => ({}) } as never, "prooflayer");
    for (const prefix of ["", "orgs/", "orgs/org_1", "orgs/../", "autre/org_1/"]) {
      await expect(store.deletePrefix(prefix), prefix).rejects.toThrow("préfixe d'objet invalide");
    }
  });
});

describe("magasin local : taille et ménage de la zone d'arrivée (revue finale)", () => {
  it("taille sans lecture ; seuls les dépôts anciens de la zone d'arrivée sont supprimés", async () => {
    const { mkdtemp, rm, utimes } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { LocalObjectStore } = await import("@/server/storage/object-store");
    const dir = await mkdtemp(join(tmpdir(), "pl-store-"));
    try {
      const store = new LocalObjectStore(dir);
      await store.put("orgs/org_1/incoming/a", Buffer.from("12345"));
      await store.put("orgs/org_1/incoming/b", Buffer.from("1"));
      const old = new Date(Date.now() - 2 * 86_400_000);
      await utimes(join(dir, "orgs/org_1/incoming/a"), old, old);
      expect(await store.size("orgs/org_1/incoming/a")).toBe(5);
      expect(await store.size("orgs/org_1/incoming/absent")).toBeNull();
      const cutoff = new Date(Date.now() - 86_400_000);
      expect(await store.deleteOlderThan("orgs/org_1/incoming/", cutoff)).toBe(1);
      expect(await store.size("orgs/org_1/incoming/a")).toBeNull();
      expect(await store.size("orgs/org_1/incoming/b")).toBe(1);
      expect(await store.deleteOlderThan("orgs/org_2/incoming/", cutoff)).toBe(0);
      await expect(store.deleteOlderThan("orgs/org_1/", cutoff)).rejects.toThrow(
        "préfixe d'objet invalide",
      );
      await expect(store.deleteOlderThan("orgs/org_1/raw/", cutoff)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
