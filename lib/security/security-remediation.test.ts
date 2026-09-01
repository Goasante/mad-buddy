import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function apiMutationRoutes(): Array<{ path: string; source: string }> {
  const root = join(ROOT, "app", "api");
  const routes: Array<{ path: string; source: string }> = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name === "route.ts") {
        const source = readFileSync(path, "utf8");
        if (/export async function (?:POST|PUT|PATCH|DELETE)/.test(source)) {
          routes.push({
            path: relative(ROOT, path).split(sep).join("/"),
            source
          });
        }
      }
    }
  };
  walk(root);
  return routes;
}

describe("signup creates confirmed accounts without provider email", () => {
  const webSignup = read("app/(auth)/actions.ts");
  const nativeSignup = read("lib/auth/bootstrap.ts");

  /**
   * POLICY REVERSED, DELIBERATELY.
   *
   * These previously asserted the opposite -- that signup must go through
   * `auth.signUp` and must NOT pre-confirm. That policy made account creation
   * depend on Supabase's built-in SMTP, which caps at a few messages an hour;
   * once exhausted, signup failed and created no account while telling the
   * user it had worked. It also produced a live dead end: the form said "check
   * your email" for a message that was never sent, because Confirm Email is
   * disabled on the project.
   *
   * Mad Buddy does not verify email at signup. Accounts are created confirmed
   * by the service role, so behaviour is decided here rather than by a
   * dashboard toggle. The detailed guarantees live in
   * lib/auth/signup-policy.test.ts; these two keep the security suite honest
   * about which policy is in force.
   */
  it("creates accounts with the service role and pre-confirms them", () => {
    for (const source of [webSignup, nativeSignup]) {
      expect(source).not.toContain(".auth.signUp(");
    }
    expect(nativeSignup).toContain("admin.auth.admin.createUser");
    expect(nativeSignup).toMatch(/email_confirm\s*:\s*true/);
  });

  it("returns an authenticated product redirect after signup", () => {
    const signupAction = webSignup.slice(
      webSignup.indexOf("export async function signUpAction"),
      webSignup.indexOf("export async function loginAction")
    );
    expect(signupAction).toContain('redirectTo: "/onboarding"');
    expect(signupAction).not.toContain("Check your email and open the confirmation link");
    expect(nativeSignup).not.toContain("requiresEmailConfirmation: true");
  });
});

describe("Turnstile credentials stay correctly separated", () => {
  it("exposes only the site key and keeps the secret server-side", () => {
    const webClient = `${read("components/auth/signup-form.tsx")}\n${read(
      "components/auth/forgot-password-form.tsx"
    )}`;
    const nativeClient = read("mobile/src/screens/SignupScreen.tsx");
    const exampleEnv = read(".env.example");

    expect(webClient).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(nativeClient).not.toContain("TURNSTILE_SECRET_KEY");
    expect(webClient).not.toContain("TURNSTILE_SECRET_KEY");
    expect(exampleEnv).toContain("TURNSTILE_SECRET_KEY=");
    expect(exampleEnv).not.toMatch(/NEXT_PUBLIC_TURNSTILE_SECRET|VITE_TURNSTILE_SECRET/);
  });
});

describe("native sessions use platform storage without changing browser storage", () => {
  const adapter = read("mobile/src/lib/auth-storage.ts");
  const nativeBranch = adapter.slice(
    adapter.indexOf("const nativeSecureStorage"),
    adapter.indexOf("const browserStorage")
  );
  const browserBranch = adapter.slice(
    adapter.indexOf("const browserStorage"),
    adapter.indexOf("export function mobileAuthStorage")
  );

  it("uses SecureStorage for native reads and writes", () => {
    expect(adapter).toContain("Capacitor.isNativePlatform()");
    expect(nativeBranch).toContain("SecureStorage.getItem");
    expect(nativeBranch).toContain("SecureStorage.setItem");
    expect(nativeBranch).toContain("SecureStorage.removeItem");
    expect(nativeBranch).not.toContain("localStorage");
  });

  it("keeps normal localStorage for the browser and PWA branch", () => {
    expect(browserBranch).toContain("window.localStorage.getItem");
    expect(browserBranch).toContain("window.localStorage.setItem");
    expect(browserBranch).toContain("window.localStorage.removeItem");
  });
});

describe("state-changing cookie APIs use the centralized CSRF guard", () => {
  const signedExemptions = new Set([
    "app/api/auth/signup/route.ts",
    "app/api/csp-report/route.ts",
    "app/api/paystack/webhook/route.ts"
  ]);

  it("routes mutations through resolveApiUser or the explicit origin guard", () => {
    const offenders = apiMutationRoutes()
      .filter(({ path }) => !signedExemptions.has(path))
      // A retired endpoint that only answers 410 has no state to guard.
      .filter(({ source }) => !/status:\s*410/.test(source))
      .filter(
        ({ source }) =>
          !source.includes("resolveApiUser") &&
          !source.includes("invalidMutationOriginResponse") &&
          !source.includes("validateMutationRequest")
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("password reset revokes existing sessions", () => {
  it("uses Supabase global sign-out after a successful password update", () => {
    const actions = read("app/(auth)/actions.ts");
    const resetAction = actions.slice(
      actions.indexOf("export async function resetPasswordAction"),
      actions.indexOf("export async function logoutAction")
    );
    expect(resetAction.indexOf("auth.updateUser")).toBeGreaterThan(-1);
    expect(resetAction).toContain('auth.signOut({ scope: "global" })');
    expect(resetAction.indexOf('auth.signOut({ scope: "global" })')).toBeGreaterThan(
      resetAction.indexOf("auth.updateUser")
    );
  });
});
