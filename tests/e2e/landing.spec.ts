// Page d'accueil publique : toujours en anglais (une seule adresse canonique), métadonnées SEO, données structurées,
// appels à l'action vers le classifieur et l'essai, robots.txt et sitemap.xml.
import { expect, test } from "@playwright/test";

test("en anglais quels que soient le cookie de langue et le navigateur", async ({ browser }) => {
  const context = await browser.newContext({ locale: "fr-FR" });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: "http://localhost:3000" }]);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("EU AI Act Compliance Software for SaaS Teams · ProofLayer");
  // Le reste de l'application suit toujours la préférence de langue.
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await context.close();
});

test("un en-tête de langue fourni par le client est ignoré ailleurs que sur le site public", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "fr-FR",
    extraHTTPHeaders: { "x-prooflayer-site-locale": "en" },
  });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await context.close();
});

test("SEO : description, canonique, Open Graph, données structurées", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /EU AI Act/u);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /^https?:\/\/[^/]+\/?$/u,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /opengraph-image/u,
  );
  const json = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  );
  const types = (json["@graph"] as { "@type": string }[]).map((n) => n["@type"]);
  expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]);
  const faq = json["@graph"][3].mainEntity as unknown[];
  expect(faq.length).toBe(await page.locator("details").count());
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("appels à l'action : classifieur gratuit et essai", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start a 14-day trial" }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/u);
  await page.goto("/");
  await page.getByRole("link", { name: "Classify your AI system for free" }).last().click();
  await expect(page).toHaveURL(/\/classifier$/u);
  // Rechargement complet : le classifieur suit la langue de l'utilisateur, pas celle de la page d'accueil.
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("robots.txt hors production : rien n'est indexé ; sitemap des pages publiques", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/\s*$/mu);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/classifier", "/verify", "/trust", "/legal/terms"]) {
    expect(sitemap).toContain(path);
  }
});
