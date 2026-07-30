import "server-only";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

type TurnstileResponse = {
  success?: boolean;
  action?: string;
  "error-codes"?: string[];
};

export type TurnstileAction = "signup" | "password_recovery";

export type TurnstileVerification = {
  ok: boolean;
  reason?: "missing_token" | "missing_secret" | "invalid_token" | "verification_unavailable";
};

/**
 * Turnstile is mandatory in production. In local/test environments it becomes
 * mandatory as soon as either key is configured, which makes staging behave
 * like production without making secret-less local builds unusable.
 */
export function isTurnstileRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "production" ||
    Boolean(env.TURNSTILE_SECRET_KEY || env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
  );
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  expectedAction: TurnstileAction,
  env: NodeJS.ProcessEnv = process.env
): Promise<TurnstileVerification> {
  if (!isTurnstileRequired(env)) return { ok: true };

  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, reason: "missing_secret" };

  const normalizedToken = token?.trim();
  if (!normalizedToken || normalizedToken.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing_token" };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: normalizedToken
    });
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return { ok: false, reason: "verification_unavailable" };

    const result = (await response.json()) as TurnstileResponse;
    if (!result.success || result.action !== expectedAction) {
      return { ok: false, reason: "invalid_token" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "verification_unavailable" };
  }
}

export function turnstileErrorMessage(result: TurnstileVerification): string {
  if (result.reason === "missing_secret" || result.reason === "verification_unavailable") {
    return "The security check is temporarily unavailable. Try again shortly.";
  }
  return "Complete the security check and try again.";
}
