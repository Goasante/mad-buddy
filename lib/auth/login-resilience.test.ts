import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const actions = stripComments(
  readFileSync(join(process.cwd(), "app/(auth)/actions.ts"), "utf8")
);
const loginAction = actions.slice(
  actions.indexOf("export async function loginAction"),
  actions.indexOf("export async function adminLoginAction")
);

describe("login transport resilience", () => {
  it("retries only the explicit retryable Supabase transport error", () => {
    expect(actions).toContain('error?.name === "AuthRetryableFetchError"');
    expect(loginAction).toContain("attempt < 2");
    expect(loginAction).toContain("isRetryableAuthTransportError(error)");
    expect(loginAction).toContain("waitForAuthTransportRetry()");
  });

  it("does not retry ordinary authentication rejections", () => {
    expect(loginAction).toContain("if (!isRetryableAuthTransportError(error) || attempt === 1) break");
    expect(loginAction).toContain('error.code === "email_not_confirmed"');
    expect(loginAction).toContain("Email address or password is incorrect.");
  });

  it("classifies provider transport failure as unavailable, not unauthorized", () => {
    expect(loginAction).toContain("statusCode: transportFailure ? 503 : 401");
    expect(loginAction).toContain("could not reach the login service");
  });
});
