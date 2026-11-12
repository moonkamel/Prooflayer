// Audit axe partagé (§5.2 : WCAG 2.2 niveau AA). Tout nouvel écran est vérifié par cette fonction : dans
// a11y.spec.ts quand une adresse suffit, sinon dans le parcours qui amène l'écran dans l'état voulu.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `violations axe sur ${label}`).toEqual([]);
}
