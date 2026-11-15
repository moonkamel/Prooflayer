// PL-605 (ASVS 7.4.1) — Une erreur interne ne divulgue ni message ni pile ; une erreur métier garde sa clé.
import { describe, expect, it } from "vitest";
import { safeErrorShape } from "@/server/error-shape";

const shape = (message: string) => ({
  message,
  code: -32603,
  data: { code: "X", httpStatus: 500, path: "system.create", stack: "Error: at db.ts:12" },
});

describe("forme des erreurs", () => {
  it("erreur interne : message générique, sans pile", () => {
    const out = safeErrorShape(
      shape('relation "AiSystem" violates constraint'),
      "INTERNAL_SERVER_ERROR",
    );
    expect(out.message).toBe("internal_error");
    expect(out.data).not.toHaveProperty("stack");
    expect(out.data.path).toBe("system.create");
  });

  it("erreur métier : clé conservée, pile retirée", () => {
    const out = safeErrorShape(shape("billing.readOnly"), "FORBIDDEN");
    expect(out.message).toBe("billing.readOnly");
    expect(out.data).not.toHaveProperty("stack");
  });
});
