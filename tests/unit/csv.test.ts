import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/server/services/csv";

describe("csvCell", () => {
  it.each([
    ["simple", "simple"],
    ["", ""],
    [null, ""],
    [42, "42"],
    ["a,b", '"a,b"'],
    ['dit "bonjour"', '"dit ""bonjour"""'],
    ["ligne 1\nligne 2", '"ligne 1\nligne 2"'],
  ])("%j → %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it.each(['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "neutralise la formule %j",
    (input) => {
      const cell = csvCell(input);
      expect(cell.startsWith(`"'`)).toBe(true);
    },
  );
});

describe("toCsv", () => {
  it("produit un en-tête et des lignes séparées par CRLF", () => {
    expect(
      toCsv(
        ["date", "action"],
        [
          ["2026-11-11T10:00:00.000Z", "member.invite"],
          ["2026-11-11T11:00:00.000Z", "a,b"],
        ],
      ),
    ).toBe(
      'date,action\r\n2026-11-11T10:00:00.000Z,member.invite\r\n2026-11-11T11:00:00.000Z,"a,b"\r\n',
    );
  });
});
