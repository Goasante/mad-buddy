import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideOnboardingRecovery, type RecoveryProfile } from "@/lib/onboarding/recovery";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function profile(overrides: Partial<RecoveryProfile> = {}): RecoveryProfile {
  return {
    is_onboarded: false,
    username: "kofi",
    full_name: "Kofi Mensah",
    bio: "Loves hiking.",
    mood_status: "open",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// The stranded state this exists to fix
// ---------------------------------------------------------------------------

describe("stranded onboarding recovery", () => {
  it("finishes an account whose profile is complete but has no progress row", () => {
    // The exact state two real accounts reached: every field filled,
    // is_onboarded rolled back to false, no onboarding_progress row.
    const decision = decideOnboardingRecovery(profile(), null);
    expect(decision.action).toBe("finish");
  });

  it("finishes an account whose progress completed but whose flag was rolled back", () => {
    const decision = decideOnboardingRecovery(profile(), {
      exists: true,
      completedAt: "2026-08-01T10:00:00Z"
    });
    expect(decision.action).toBe("finish");
  });

  it("is idempotent — a recovered account is then left alone", () => {
    const recovered = decideOnboardingRecovery(profile({ is_onboarded: true }), {
      exists: true,
      completedAt: "2026-08-01T10:00:00Z"
    });
    expect(recovered.action).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// It must never skip real onboarding
// ---------------------------------------------------------------------------

describe("recovery never bypasses onboarding", () => {
  it("leaves a brand-new account alone", () => {
    const decision = decideOnboardingRecovery(
      profile({ username: "muddy_a1b2c3", full_name: "", bio: null, mood_status: null }),
      null
    );
    expect(decision.action).toBe("none");
  });

  it("leaves an account still carrying a signup placeholder username", () => {
    for (const username of ["muddy_a1b2c3", "user_ff0011", "MUDDY_AB12CD"]) {
      expect(decideOnboardingRecovery(profile({ username }), null).action).toBe("none");
    }
  });

  it("leaves a genuinely half-finished account to continue normally", () => {
    expect(decideOnboardingRecovery(profile({ bio: null }), null).action).toBe("none");
    expect(decideOnboardingRecovery(profile({ mood_status: null }), null).action).toBe("none");
    expect(decideOnboardingRecovery(profile({ bio: "   " }), null).action).toBe("none");
  });

  it("leaves an account with no profile row to be provisioned first", () => {
    expect(decideOnboardingRecovery(null, null).action).toBe("none");
  });

  it("never touches an account that already completed onboarding", () => {
    expect(decideOnboardingRecovery(profile({ is_onboarded: true }), null).action).toBe("none");
    // Even one with missing fields — completed is completed.
    expect(
      decideOnboardingRecovery(profile({ is_onboarded: true, bio: null, mood_status: null }), null).action
    ).toBe("none");
  });

  it("requires a real name as well as a real username", () => {
    expect(decideOnboardingRecovery(profile({ full_name: "" }), null).action).toBe("none");
    expect(decideOnboardingRecovery(profile({ username: null }), null).action).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Service behaviour
// ---------------------------------------------------------------------------

describe("recovery service", () => {
  const service = read("lib/onboarding/recovery-service.ts");
  // Stage 2.1: the write block moved into the canonical primitive, which
  // recovery now shares with every normal completion path. These assertions
  // follow it there rather than being dropped.
  const finalize = read("lib/onboarding/finalize.ts");

  it("provisions through the canonical primitive rather than its own writes", () => {
    expect(service).toContain("finalizeOnboarding(admin, userId)");
    expect(service).not.toContain('from("onboarding_progress").upsert');
  });

  it("writes only idempotent upserts, so re-running is a no-op", () => {
    expect(finalize).toContain('onConflict: "user_id"');
    expect(finalize).not.toContain(".insert(");
  });

  it("applies the same safe privacy default as normal completion", () => {
    expect(finalize).toContain("SAFE_DEFAULT_PRIVACY_SETUP.glowAudience");
    // And the web action no longer applies its own — it delegates.
    expect(read("app/(onboarding)/onboarding/actions.ts")).toContain("finalizeOnboarding(");
  });

  it("does NOT roll the flag back on failure — that is what stranded accounts", () => {
    expect(finalize).not.toContain("is_onboarded: false");
    expect(service).toContain("retry");
  });

  it("invents no profile content", () => {
    // Provisioning rows only; never a name, username, bio or mood.
    for (const field of ["full_name:", "username:", "bio:", "mood_status:"]) {
      expect(finalize, `finalize must not write ${field}`).not.toContain(field);
      expect(service, `recovery must not write ${field}`).not.toContain(field);
    }
  });

  it("logs without leaking secrets", () => {
    expect(service).toContain("logBackendEvent");
    for (const secret of ["password", "access_token", "refresh_token"]) {
      expect(service, `must not log ${secret}`).not.toContain(secret);
      expect(finalize, `must not log ${secret}`).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("recovery wiring", () => {
  const page = read("app/(onboarding)/onboarding/page.tsx");

  it("runs on the onboarding gate, where stranded users land", () => {
    expect(page).toContain("recoverOnboardingIfStranded");
    expect(page).toContain('redirect("/dashboard")');
  });

  it("still redirects an already-onboarded user without recovering", () => {
    expect(page).toContain("if (profile?.is_onboarded) {");
  });

  it("is guarded on the server env so a missing config cannot throw", () => {
    expect(page).toContain("serverEnv.url && serverEnv.serviceRoleKey");
  });

  it("tells the user their details are safe when completion fails", () => {
    // The wording is now one shared constant, so every entry point says the
    // same thing rather than inventing its own phrasing.
    expect(read("app/(onboarding)/onboarding/actions.ts")).toContain("FINALIZE_RECOVERABLE_MESSAGE");
    const finalize = read("lib/onboarding/finalize.ts");
    expect(finalize).toContain("Your profile was saved");
    expect(finalize).toContain("Reopen the app to continue");
  });
});

// ---------------------------------------------------------------------------
// There is no approval policy — assert it stays that way by accident
// ---------------------------------------------------------------------------

describe("no manual approval gate", () => {
  it("has no approval flag in the onboarding or auth paths", () => {
    for (const path of [
      "lib/onboarding/recovery.ts",
      "lib/onboarding/recovery-service.ts",
      "app/(onboarding)/onboarding/page.tsx",
      "lib/profiles/ensure-profile.ts",
      "lib/auth/oauth-account.ts"
    ]) {
      const source = read(path);
      for (const flag of ["is_approved", "approved_at", "awaiting_approval", "is_banned", "suspended_at"]) {
        expect(source, `${path} should not gate on ${flag}`).not.toContain(flag);
      }
    }
  });

  it("keeps provisioning idempotent on both signup paths", () => {
    expect(read("lib/auth/bootstrap.ts")).toContain('onConflict: "user_id"');
    expect(read("lib/auth/oauth-account.ts")).toContain('onConflict: "user_id"');
  });
});
