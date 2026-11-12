import { expect, test } from "@playwright/test";

test("la page d'accueil répond", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ProofLayer");
});

test("en-têtes de sécurité : CSP à nonce propre à chaque requête, HSTS, intégration interdite (PL-108)", async ({
  page,
}) => {
  const csp: string[] = [];
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/iu.test(m.text())) violations.push(m.text());
  });
  for (const path of ["/", "/sign-in"]) {
    const response = await page.goto(path);
    const headers = response!.headers();
    csp.push(headers["content-security-policy"] ?? "");
    expect(headers["strict-transport-security"]).toContain("preload");
    expect(headers["x-frame-options"]).toBe("DENY");
  }
  for (const value of csp) {
    expect(value).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/u);
    expect(value).toContain("frame-ancestors 'none'");
  }
  expect(csp[0]).not.toBe(csp[1]);
  // Les scripts de Next.js portent le nonce : la page est hydratée sans violation de CSP.
  expect(violations).toEqual([]);
});
