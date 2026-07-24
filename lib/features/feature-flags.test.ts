import { describe, expect, it } from "vitest";
import { resolveGlobalFeatureFlag } from "@/lib/features/feature-flags";

describe("global feature flags", () => {
  it("fails closed when a flag is missing", () => {
    expect(resolveGlobalFeatureFlag(null)).toBe(false);
  });

  it("only enables an explicit on flag", () => {
    expect(resolveGlobalFeatureFlag({ status: "on", default_value: false })).toBe(true);
    expect(resolveGlobalFeatureFlag({ status: "off", default_value: true })).toBe(false);
    expect(resolveGlobalFeatureFlag({ status: "archived", default_value: true })).toBe(false);
  });

  it("uses the safe configured default during a rollout", () => {
    expect(resolveGlobalFeatureFlag({ status: "rollout", default_value: false })).toBe(false);
    expect(resolveGlobalFeatureFlag({ status: "rollout", default_value: true })).toBe(true);
  });
});
