// PL-208 — Classifieur public : lien partageable avec réponses préremplies, adresse professionnelle.
import { describe, expect, it } from "vitest";
import { decodeResponses, encodeResponses } from "@/server/classify/share";
import type { Responses } from "@/server/classify/questionnaire";
import { isProfessionalEmail } from "@/server/services/professional-email";

describe("lien partageable", () => {
  const responses: Responses = {
    aiSystem: true,
    scope: [],
    prohibited: [],
    annexI: false,
    annexIII: ["4(a)"],
    profiling: true,
    developer: true,
  };

  it("restitue les réponses encodées", () => {
    const r = encodeResponses(responses);
    expect(r).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeResponses(r)).toEqual(responses);
  });

  it("écarte les réponses hors chemin ou invalides, sans échouer", () => {
    const tampered = Buffer.from(
      JSON.stringify({ aiSystem: true, scope: ["inconnu"], annexIII: ["4(a)"], profiling: "oui" }),
    ).toString("base64url");
    expect(decodeResponses(tampered)).toEqual({ aiSystem: true });
    expect(decodeResponses("@@@")).toEqual({});
    expect(decodeResponses(Buffer.from("[1]").toString("base64url"))).toEqual({});
    expect(decodeResponses("a".repeat(2001))).toEqual({});
    expect(decodeResponses(null)).toEqual({});
  });

  it("garde les caractères non ASCII", () => {
    expect(decodeResponses(encodeResponses({ aiSystem: false }))).toEqual({ aiSystem: false });
  });
});

describe("adresse professionnelle", () => {
  it.each([
    ["clara.martin@talvio.example", true],
    ["CTO@Recrutys.fr", true],
    ["quelquun@gmail.com", false],
    ["x@orange.fr", false],
    ["x@proton.me", false],
    ["pas-une-adresse", false],
    ["x@domaine", false],
  ])("%s → %s", (email, expected) => {
    expect(isProfessionalEmail(email)).toBe(expected);
  });
});
