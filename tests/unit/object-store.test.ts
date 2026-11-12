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
