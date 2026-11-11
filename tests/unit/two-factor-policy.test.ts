import { describe, expect, it } from "vitest";
import { mustSetUpTwoFactor } from "@/server/services/two-factor-policy";

describe("mustSetUpTwoFactor (§3.2 E10 : 2FA obligatoire pour owner et admin)", () => {
  it.each([
    [["owner"], false, true],
    [["admin"], false, true],
    [["contributor", "admin"], false, true],
    [["owner"], true, false],
    [["admin"], true, false],
    [["contributor"], false, false],
    [["auditor"], false, false],
    [["contributor", "auditor"], false, false],
    [[], false, false],
  ] as const)("rôles %j, 2FA active %s → %s", (roles, enabled, expected) => {
    expect(mustSetUpTwoFactor(roles, enabled)).toBe(expected);
  });
});
