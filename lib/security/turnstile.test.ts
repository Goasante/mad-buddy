import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTurnstileRequired,
  verifyTurnstileToken
} from "@/lib/security/turnstile";

const productionEnv = {
  NODE_ENV: "production",
  TURNSTILE_SECRET_KEY: "test-only-secret"
} as NodeJS.ProcessEnv;

describe("Cloudflare Turnstile verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is mandatory in production and optional in an unconfigured local environment", () => {
    expect(isTurnstileRequired({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isTurnstileRequired({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("rejects missing tokens and missing server secrets when required", async () => {
    await expect(verifyTurnstileToken(undefined, "signup", productionEnv)).resolves.toEqual({
      ok: false,
      reason: "missing_token"
    });
    await expect(
      verifyTurnstileToken("challenge-token", "signup", {
        NODE_ENV: "production"
      } as NodeJS.ProcessEnv)
    ).resolves.toEqual({ ok: false, reason: "missing_secret" });
  });

  it("accepts only a successful challenge for the expected action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, action: "signup" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, action: "password_recovery" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstileToken("challenge-token", "signup", productionEnv)
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyTurnstileToken("challenge-token", "signup", productionEnv)
    ).resolves.toEqual({ ok: false, reason: "invalid_token" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Cloudflare cannot verify the challenge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      verifyTurnstileToken("challenge-token", "password_recovery", productionEnv)
    ).resolves.toEqual({ ok: false, reason: "verification_unavailable" });
  });
});
