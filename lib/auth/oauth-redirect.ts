const AUTH_ERROR_MESSAGES = {
  cancelled: "Sign in was cancelled. Please try again when you are ready.",
  callback_failed: "We could not complete that sign in. Please try again.",
  account_setup_failed: "Your account was connected, but setup could not finish. Please try again."
} as const;

export type OAuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

export function safeAuthNext(value: string | null, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  return value;
}

export function oauthErrorMessage(value?: string) {
  if (!value || !(value in AUTH_ERROR_MESSAGES)) {
    return null;
  }

  return AUTH_ERROR_MESSAGES[value as OAuthErrorCode];
}

export function authErrorRedirect(origin: string, path: "/login" | "/signup", code: OAuthErrorCode) {
  const url = new URL(path, origin);
  url.searchParams.set("oauth_error", code);
  return url;
}
