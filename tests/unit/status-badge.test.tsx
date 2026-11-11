import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { CONTROL_STATUSES, STATUS_STYLES, StatusBadge } from "@/components/status-badge";

/** Rapport de contraste WCAG 2.x entre deux couleurs #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const render = (
  status: (typeof CONTROL_STATUSES)[number],
  messages: typeof fr = fr,
  locale: "fr" | "en" = "fr",
) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StatusBadge status={status} />
    </NextIntlClientProvider>,
  );

describe("badges de statut (§5.2)", () => {
  it("couvre exactement les six statuts du modèle", () => {
    expect(CONTROL_STATUSES.sort()).toEqual(
      ["FAIL", "MISSING", "NOT_APPLICABLE", "PARTIAL", "PASS", "STALE"].sort(),
    );
  });

  it.each(CONTROL_STATUSES)("%s : icône décorative, libellé visible, contraste AA", (status) => {
    const html = render(status);
    expect(html).toContain('aria-hidden="true"'); // l'icône n'est pas lue, le libellé l'est
    expect(html).toContain(`>${fr.controlStatus[status]}</span>`);
    const { fg, bg } = STATUS_STYLES[status];
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("chaque statut a sa propre icône et sa propre couleur", () => {
    const icons = new Set(CONTROL_STATUSES.map((s) => STATUS_STYLES[s].icon));
    const colors = new Set(CONTROL_STATUSES.map((s) => STATUS_STYLES[s].bg));
    expect(icons.size).toBe(6);
    expect(colors.size).toBe(6);
  });

  it("libellés traduits, jamais « conforme »", () => {
    expect(render("FAIL", en, "en")).toContain(">Failing</span>");
    expect(JSON.stringify([fr.controlStatus, en.controlStatus]).toLowerCase()).not.toMatch(
      /conform|compliant/u,
    );
  });
});

describe("jetons de couleur de la coque (globals.css)", () => {
  it.each([
    ["texte principal", "#0f172a", "#ffffff"],
    ["texte secondaire", "#475569", "#ffffff"],
    ["bouton principal", "#f8fafc", "#0f172a"],
    ["bouton destructif", "#ffffff", "#b91c1c"],
    ["lien", "#1d4ed8", "#ffffff"],
  ])("%s : contraste AA", (_, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
