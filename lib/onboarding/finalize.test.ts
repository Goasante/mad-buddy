import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FINALIZE_RECOVERABLE_MESSAGE } from "@/lib/onboarding/finalize";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const finalize = read("lib/onboarding/finalize.ts");

/** Every entry point that can finish onboarding. */
const ENTRY_POINTS = [
  "app/(onboarding)/onboarding/actions.ts",
  "app/api/onboarding/complete/route.ts",
  "app/(app)/onboarding-actions.ts",
  "lib/onboarding/recovery-service.ts"
] as const;

// ---------------------------------------------------------------------------
// One canonical service
// ---------------------------------------------------------------------------

describe("canonical completion service", () => {
  it("is used by every entry point", () => {
    for (const path of ENTRY_POINTS) {
      expect(read(path), `${path} must finalize through the canonical service`).toContain(
        "finalizeOnboarding("
      );
    }
  });

  it("is the only place the completion rows are written", () => {
    // No entry point may write these itself any more.
    for (const path of ENTRY_POINTS) {
      const source = read(path);
      expect(source, `${path} must not write onboarding_progress directly`).not.toContain(
        'from("onboarding_progress").upsert'
      );
      expect(source, `${path} must not write privacy_setup_versions directly`).not.toContain(
        'from("privacy_setup_versions")'
      );
      expect(source, `${path} must not flip is_onboarded directly`).not.toContain("is_onboarded: true");
    }
    expect(finalize).toContain('from("onboarding_progress")');
    expect(finalize).toContain('from("privacy_setup_versions")');
    expect(finalize).toContain("is_onboarded: true");
  });

  it("writes all three completion rows together", () => {
    expect(finalize).toContain("await Promise.all([");
    for (const table of ["onboarding_progress", "profiles", "privacy_setup_versions"]) {
      expect(finalize).toContain(table);
    }
  });

  it("applies one safe privacy default everywhere", () => {
    expect(finalize).toContain("SAFE_DEFAULT_PRIVACY_SETUP.glowAudience");
    // No entry point may choose its own visibility.
    for (const path of ENTRY_POINTS) {
      expect(read(path), `${path} must not set visibility itself`).not.toContain("visibility_status:");
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotence — no duplicate rows
// ---------------------------------------------------------------------------

describe("idempotence", () => {
  it("upserts on user_id rather than inserting", () => {
    expect(finalize).not.toContain(".insert(");
    const conflicts = finalize.match(/onConflict: "user_id"/g) ?? [];
    // onboarding_progress and privacy_setup_versions; profiles is an update.
    expect(conflicts.length).toBe(2);
  });

  it("updates the profile flag rather than inserting a second row", () => {
    expect(finalize).toContain('.from("profiles")\n      .update(');
    expect(finalize).toContain('.eq("user_id", userId)');
  });

  it("sets the flag to a fixed value, so repeat completion is a no-op", () => {
    expect(finalize).toContain("is_onboarded: true");
    expect(finalize).not.toContain("is_onboarded: !");
  });
});

// ---------------------------------------------------------------------------
// Recoverable error model
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("never rolls is_onboarded back after a valid profile was saved", () => {
    // That rollback is what stranded real accounts in Stage 2.
    expect(finalize).not.toContain("is_onboarded: false");
    for (const path of ENTRY_POINTS) {
      expect(read(path), `${path} must not roll the flag back`).not.toContain("is_onboarded: false");
    }
  });

  it("reports which write failed, and that it is recoverable", () => {
    expect(finalize).toContain('failed: "progress" | "profile" | "privacy"');
    expect(finalize).toContain("recoverable: true");
  });

  it("gives one clear message telling the user their profile is safe", () => {
    expect(FINALIZE_RECOVERABLE_MESSAGE).toContain("Your profile was saved");
    expect(FINALIZE_RECOVERABLE_MESSAGE).toContain("Reopen the app to continue");
    // Every entry point uses that one message rather than its own wording.
    for (const path of ["app/(onboarding)/onboarding/actions.ts", "app/(app)/onboarding-actions.ts"]) {
      expect(read(path)).toContain("FINALIZE_RECOVERABLE_MESSAGE");
    }
  });

  it("logs failures without leaking secrets", () => {
    expect(finalize).toContain("logBackendEvent");
    for (const secret of ["password", "access_token", "refresh_token", "session"]) {
      expect(finalize, `must not log ${secret}`).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// The native gap this stage closed
// ---------------------------------------------------------------------------

describe("native completion route", () => {
  const route = read("app/api/onboarding/complete/route.ts");

  it("finalizes after saving the profile", () => {
    // Previously it called completeOnboarding alone, which deliberately leaves
    // is_onboarded = false — so native users were returned to onboarding on
    // every launch, with no progress row ever written.
    expect(route).toContain("completeOnboarding(");
    expect(route).toContain("finalizeOnboarding(");
    expect(route.indexOf("completeOnboarding(")).toBeLessThan(route.indexOf("finalizeOnboarding("));
  });

  it("does not finalize when the profile itself was rejected", () => {
    expect(route).toContain("if (!result.ok)");
  });

  it("returns a recoverable status when finalization fails", () => {
    expect(route).toContain("FINALIZE_RECOVERABLE_MESSAGE");
    expect(route).toContain("status: 503");
  });
});

// ---------------------------------------------------------------------------
// Validation and eligibility are unchanged
// ---------------------------------------------------------------------------

describe("validation and eligibility preserved", () => {
  it("still validates the profile before finalizing", () => {
    const complete = read("lib/onboarding/complete.ts");
    expect(complete).toContain("onboardingSchema.safeParse");
    expect(complete).toContain("validateUsername");
    expect(complete).toContain("validateDateOfBirth");
  });

  it("keeps the V2 step guard", () => {
    const v2 = read("app/(app)/onboarding-actions.ts");
    expect(v2).toContain("canCompleteOnboarding(state)");
    expect(v2).toContain("Finish your profile and privacy setup first.");
  });

  it("does not broaden recovery eligibility", () => {
    const recovery = read("lib/onboarding/recovery.ts");
    // Still requires a real identity plus both prompted fields.
    expect(recovery).toContain("isPlaceholderIdentity");
    expect(recovery).toContain("hasBio && hasMood");
  });

  it("keeps recovery reusing the canonical primitive", () => {
    const service = read("lib/onboarding/recovery-service.ts");
    expect(service).toContain("finalizeOnboarding(admin, userId)");
    // It no longer duplicates the write block.
    expect(service).not.toContain("current_step: \"completed\"");
  });
});
