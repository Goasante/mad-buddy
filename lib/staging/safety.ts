/**
 * Staging seed safety guards.
 *
 * The seeder writes ~100 auth users and a large synthetic dataset. Pointed at
 * the wrong project it would be an incident, so refusal is the DEFAULT and
 * every path to mutation has to be opened deliberately.
 *
 * The three guards are independent on purpose:
 *
 *   1. the resolved project ref must not be production;
 *   2. an explicit opt-in env flag must be present;
 *   3. an unparseable/unknown target refuses rather than guessing.
 *
 * `NODE_ENV` is deliberately NOT one of them. It is trivially wrong in a CI
 * shell and says nothing about which DATABASE the URL points at.
 */

/**
 * The production project ref. Hard-coded because this is a guard: reading it
 * from the environment would let a mistyped env var disable the check.
 * A project ref is not a secret -- it is the public subdomain of the API URL.
 */
export const PRODUCTION_PROJECT_REF = "cabkhxxnrybzhkbtoiiz";

/** The env var that must be exactly "YES" before any mutation is attempted. */
export const STAGING_OPT_IN_ENV = "MAD_BUDDY_ALLOW_STAGING_SEED";

/** The env var carrying the shared synthetic-account password. Never logged. */
export const STAGING_PASSWORD_ENV = "MAD_BUDDY_STAGING_USER_PASSWORD";

export type SafetyRefusal = {
  ok: false;
  /** Stable machine-readable reason, safe to print and to assert on in tests. */
  code:
    | "missing_url"
    | "unparseable_url"
    | "production_ref"
    | "missing_opt_in"
    | "missing_service_role"
    | "missing_password";
  message: string;
};

export type SafetyApproval = {
  ok: true;
  projectRef: string;
  /** Origin only -- never the key material. */
  supabaseUrl: string;
};

export type SafetyResult = SafetyRefusal | SafetyApproval;

export type SafetyInput = {
  supabaseUrl?: string | undefined;
  serviceRoleKey?: string | undefined;
  optIn?: string | undefined;
  password?: string | undefined;
  /** Dry runs still validate config, but never need credentials to mutate. */
  apply: boolean;
};

/**
 * Extract the project ref from a Supabase URL.
 *
 * Supabase hosted URLs are `https://<ref>.supabase.co`. Anything we cannot
 * confidently parse returns null so the caller REFUSES -- an unknown target is
 * treated as dangerous, never as "probably fine".
 */
export function parseProjectRef(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;

  let host: string;
  try {
    host = new URL(rawUrl.trim()).hostname;
  } catch {
    return null;
  }

  // Local stacks (127.0.0.1:54321, localhost, host.docker.internal) are a
  // legitimate seed target and are named explicitly rather than by ref.
  if (host === "localhost" || host === "127.0.0.1" || host === "host.docker.internal") {
    return "local";
  }

  const match = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(host);
  return match ? match[1] : null;
}

/**
 * Decide whether seeding may proceed. Pure: no I/O, no process.exit, no
 * logging -- so the whole guard matrix is unit-testable without a database.
 */
export function evaluateSafety(input: SafetyInput): SafetyResult {
  const projectRef = parseProjectRef(input.supabaseUrl);

  if (!input.supabaseUrl || !input.supabaseUrl.trim()) {
    return {
      ok: false,
      code: "missing_url",
      message: "NEXT_PUBLIC_SUPABASE_URL is not set. Refusing: the seed target is unknown."
    };
  }

  if (projectRef === null) {
    return {
      ok: false,
      code: "unparseable_url",
      message:
        "Could not parse a Supabase project ref from NEXT_PUBLIC_SUPABASE_URL. " +
        "Refusing rather than guessing which database this is."
    };
  }

  // Checked before the opt-in flag so no combination of flags can ever reach
  // production. This ordering is asserted by a test.
  if (projectRef === PRODUCTION_PROJECT_REF) {
    return {
      ok: false,
      code: "production_ref",
      message:
        `Refusing: this is the PRODUCTION project (${PRODUCTION_PROJECT_REF}). ` +
        "The staging seeder must never run against production."
    };
  }

  if (input.optIn !== "YES") {
    return {
      ok: false,
      code: "missing_opt_in",
      message: `Refusing: set ${STAGING_OPT_IN_ENV}=YES to confirm this is a staging database.`
    };
  }

  // Credentials are only required to actually mutate. A dry run deliberately
  // works without them so the plan can be reviewed before keys are issued.
  if (input.apply) {
    if (!input.serviceRoleKey || !input.serviceRoleKey.trim()) {
      return {
        ok: false,
        code: "missing_service_role",
        message: "Refusing --apply: SUPABASE_SERVICE_ROLE_KEY is not set."
      };
    }

    if (!input.password || !input.password.trim()) {
      return {
        ok: false,
        code: "missing_password",
        message: `Refusing --apply: ${STAGING_PASSWORD_ENV} is not set.`
      };
    }
  }

  return { ok: true, projectRef, supabaseUrl: new URL(input.supabaseUrl).origin };
}
