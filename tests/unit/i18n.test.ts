import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { resolveLocale } from "@/i18n/config";

/** Liste les clés feuilles d'un fichier de messages (« a.b.c »). */
function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function leafValues(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [value];
  return Object.values(value).flatMap(leafValues);
}

describe("messages fr et en", () => {
  it("ont exactement les mêmes clés", () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(fr).sort());
  });

  it("n'ont aucune valeur vide", () => {
    for (const v of [...leafValues(fr), ...leafValues(en)]) {
      expect(typeof v === "string" && v.trim().length > 0).toBe(true);
    }
  });

  it("n'emploient jamais le mot « conforme » (règle 7 de CLAUDE.md)", () => {
    const all = JSON.stringify([fr, en]).toLowerCase();
    expect(all).not.toMatch(/\bconforme|\bcompliant\b/);
  });
});

describe("resolveLocale", () => {
  it("préfère le cookie s'il désigne une langue prise en charge", () => {
    expect(resolveLocale("en", "fr-FR,fr;q=0.9")).toBe("en");
  });

  it("ignore un cookie inconnu et suit Accept-Language", () => {
    expect(resolveLocale("de", "en-GB,en;q=0.9")).toBe("en");
  });

  it("retient la première langue prise en charge d'Accept-Language", () => {
    expect(resolveLocale(undefined, "de-DE,de;q=0.9,fr;q=0.8")).toBe("fr");
  });

  it("retombe sur le français sans indication", () => {
    expect(resolveLocale(undefined, null)).toBe("fr");
    expect(resolveLocale(undefined, "de,it")).toBe("fr");
  });
});

describe("actions du journal d'audit", () => {
  it("chaque action a un libellé en français et en anglais", async () => {
    const { AUDIT_ACTIONS } = await import("@/server/services/audit");
    const keys = AUDIT_ACTIONS.map((a) => a.replace(".", "_")).sort();
    expect(Object.keys(fr.auditActions).sort()).toEqual(keys);
    expect(Object.keys(en.auditActions).sort()).toEqual(keys);
  });
});
