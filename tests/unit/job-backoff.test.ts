import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, retryDelayMs } from "@/server/system/jobs/backoff";

const middle = () => 0.5; // aléa neutre

describe("retryDelayMs (§4.5.3)", () => {
  it("double à chaque échec à partir de 30 s", () => {
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, middle))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ]);
  });

  it("plafonne à une heure", () => {
    expect(retryDelayMs(8, middle)).toBe(3_600_000);
    expect(retryDelayMs(20, middle)).toBe(3_600_000);
    expect(retryDelayMs(20, () => 1)).toBe(3_600_000);
  });

  it("reste dans ±10 % du délai nominal", () => {
    expect(retryDelayMs(1, () => 0)).toBe(27_000);
    expect(retryDelayMs(1, () => 1)).toBe(33_000);
  });

  it("8 tentatives au plus", () => {
    expect(MAX_ATTEMPTS).toBe(8);
  });
});
