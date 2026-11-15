// Revue finale — Surface HTTP de Better Auth : les écritures d'organisation (suppression, rôles, membres, invitations,
// création) ne sont pas joignables directement ; elles passent par les services (rôles, journal d'audit, suppression
// programmée). Les routes dont l'interface a besoin restent ouvertes.
import { describe, expect, it } from "vitest";
import { auth, CLOSED_ORGANIZATION_PATHS, ORGANIZATION_LIMIT } from "@/server/auth";

const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const post = (path: string) =>
  auth.handler(
    new Request(`${base}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: "{}",
    }),
  );

describe("routes d'organisation de Better Auth", () => {
  it.each(CLOSED_ORGANIZATION_PATHS)("%s est fermée (404)", async (path) => {
    expect((await post(path)).status).toBe(404);
  });

  it("les écritures sensibles sont dans la liste", () => {
    expect(CLOSED_ORGANIZATION_PATHS).toEqual(
      expect.arrayContaining([
        "/organization/delete",
        "/organization/update-member-role",
        "/organization/remove-member",
        "/organization/invite-member",
        "/organization/create",
      ]),
    );
  });

  it("acceptation d'invitation et organisation active restent joignables (refus faute de session, pas 404)", async () => {
    for (const path of ["/organization/accept-invitation", "/organization/set-active"]) {
      expect((await post(path)).status, path).not.toBe(404);
    }
  });

  it("suppression désactivée et nombre d'organisations par utilisateur borné", () => {
    const plugin = auth.options.plugins?.find((p) => p.id === "organization") as
      | { options?: { disableOrganizationDeletion?: boolean; organizationLimit?: unknown } }
      | undefined;
    expect(plugin?.options?.disableOrganizationDeletion).toBe(true);
    expect(plugin?.options?.organizationLimit).toBe(ORGANIZATION_LIMIT);
  });
});
