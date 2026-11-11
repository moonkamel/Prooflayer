import { expect, test } from "@playwright/test";

test("la page d'accueil répond", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ProofLayer");
});
