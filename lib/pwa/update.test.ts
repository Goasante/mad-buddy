import { describe, expect, it } from "vitest";
import {
  PWA_UPDATE_ATTEMPT_COOLDOWN_MS,
  normalizeBuildId,
  parseUpdateAttempt,
  resolveBuildId,
  serializeUpdateAttempt,
  serviceWorkerUrlForBuild,
  shouldOfferBuildUpdate,
  shouldReloadForControllerChange
} from "@/lib/pwa/update";

describe("PWA build versioning", () => {
  it("uses deployment-derived identifiers without a manual version bump", () => {
    expect(
      resolveBuildId({
        VERCEL_DEPLOYMENT_ID: "deployment-42",
        VERCEL_GIT_COMMIT_SHA: "commit-41"
      })
    ).toBe("deployment-42");
    expect(resolveBuildId({ VERCEL_GIT_COMMIT_SHA: "commit-41" })).toBe("commit-41");
  });

  it("rejects malformed build identifiers and safely versions the worker URL", () => {
    expect(normalizeBuildId("https://evil.example/?token=x")).toBeNull();
    expect(serviceWorkerUrlForBuild("deployment-42")).toBe(
      "/sw.js?build=deployment-42"
    );
  });

  it("recognises a newer build for an existing installed user", () => {
    expect(
      shouldOfferBuildUpdate({
        currentBuildId: "version-a",
        latestBuildId: "version-b",
        previousAttempt: null
      })
    ).toBe(true);
    expect(
      shouldOfferBuildUpdate({
        currentBuildId: "version-b",
        latestBuildId: "version-b",
        previousAttempt: null
      })
    ).toBe(false);
  });

  it("prevents repeated reload prompts immediately after one update attempt", () => {
    const now = Date.UTC(2026, 6, 27);
    const previousAttempt = parseUpdateAttempt(
      serializeUpdateAttempt({ buildId: "version-b", attemptedAt: now - 1_000 })
    );
    expect(
      shouldOfferBuildUpdate({
        currentBuildId: "version-a",
        latestBuildId: "version-b",
        previousAttempt,
        now
      })
    ).toBe(false);
    expect(
      shouldOfferBuildUpdate({
        currentBuildId: "version-a",
        latestBuildId: "version-b",
        previousAttempt,
        now: now + PWA_UPDATE_ATTEMPT_COOLDOWN_MS
      })
    ).toBe(true);
  });

  it("allows only one reload for a controller change", () => {
    expect(
      shouldReloadForControllerChange({
        updateRequested: true,
        reloadTriggered: false
      })
    ).toBe(true);
    expect(
      shouldReloadForControllerChange({
        updateRequested: true,
        reloadTriggered: true
      })
    ).toBe(false);
  });
});
