import { describe, expect, it } from "vitest";
import {
  isManagedFeatureFlagKey,
  MANAGED_FEATURES,
  resolveGlobalFeatureFlag
} from "@/lib/features/feature-flags";

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

  it("keeps the managed catalog unique and accepts only known keys", () => {
    const keys = MANAGED_FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isManagedFeatureFlagKey("open_moments")).toBe(true);
    expect(isManagedFeatureFlagKey("socialize")).toBe(true);
    expect(isManagedFeatureFlagKey("unknown_feature")).toBe(false);
  });
});
