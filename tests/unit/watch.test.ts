// PL-603 — Fil de veille : entrées du fichier versionné valides (schéma, identifiants uniques, contrôles existants,
// textes fr et en, jamais « conforme »), publication à la date prévue, ordre du plus récent au plus ancien.
import { describe, expect, it } from "vitest";
import { CONTROL_LIBRARY } from "@/server/rules/library";
import { publishedEntries, WATCH_ENTRIES, watchEntrySchema } from "@/server/watch/entries";

describe("entrées de veille", () => {
  it("chaque entrée est valide, unique, et ne cite que des contrôles de la bibliothèque", () => {
    const keys = new Set(CONTROL_LIBRARY.map((c) => c.key));
    const ids = new Set<string>();
    for (const entry of WATCH_ENTRIES) {
      expect(watchEntrySchema.parse(entry)).toEqual(entry);
      expect(ids.has(entry.id), entry.id).toBe(false);
      ids.add(entry.id);
      expect(entry.id.startsWith(entry.publishedAt), entry.id).toBe(true);
      for (const key of entry.controls) expect(keys, `${entry.id} : ${key}`).toContain(key);
    }
    expect(JSON.stringify(WATCH_ENTRIES).toLowerCase()).not.toMatch(/\bconforme|\bcompliant\b/u);
  });

  it("publiée à sa date, de la plus récente à la plus ancienne", () => {
    const entry = (id: string, publishedAt: string) => ({ ...WATCH_ENTRIES[0]!, id, publishedAt });
    const entries = [
      entry("2027-01-02-b", "2027-01-02"),
      entry("2027-03-01-futur", "2027-03-01"),
      entry("2027-01-10-a", "2027-01-10"),
    ];
    expect(publishedEntries(new Date("2027-02-01T00:00:00Z"), entries).map((e) => e.id)).toEqual([
      "2027-01-10-a",
      "2027-01-02-b",
    ]);
    expect(publishedEntries(new Date("2027-03-01T08:00:00Z"), entries)[0]!.id).toBe(
      "2027-03-01-futur",
    );
  });
});
