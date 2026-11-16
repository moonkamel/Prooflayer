// Site public : langue imposée des pages publiques, indexation seulement en production.
import { describe, expect, it } from "vitest";
import { forcedLocaleFor } from "@/i18n/config";
import { indexable, PRIVATE_PREFIXES, PUBLIC_PAGES, siteUrl } from "@/lib/site";

describe("site public", () => {
  it("la page d'accueil est toujours en anglais ; le reste suit la préférence", () => {
    expect(forcedLocaleFor("/")).toBe("en");
    expect(forcedLocaleFor("/sign-in")).toBeNull();
    expect(forcedLocaleFor("/classifier")).toBeNull();
  });

  it("indexation seulement en production Vercel", () => {
    expect(indexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(indexable({ VERCEL_ENV: "preview" })).toBe(false);
    expect(indexable({})).toBe(false);
  });

  it("adresse publique et pages : aucune page du sitemap n'est privée", () => {
    expect(siteUrl({ BETTER_AUTH_URL: "https://app.example.test" }).origin).toBe(
      "https://app.example.test",
    );
    for (const page of PUBLIC_PAGES) {
      expect(
        PRIVATE_PREFIXES.some((p) => page.path.startsWith(p)),
        page.path,
      ).toBe(false);
    }
  });
});
