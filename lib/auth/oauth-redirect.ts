import { POST_LOGIN_ROUTE } from "@/lib/routes";

const AUTH_ERROR_MESSAGES = {
  cancelled: "Sign in was cancelled. Please try again when you are ready.",
  callback_failed: "We could not complete that sign in. Please try again.",
  account_setup_failed: "Your account was connected, but setup could not finish. Please try again."
} as const;

export type OAuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

const AUTH_DESTINATION_ROOTS = new Set([
  "admin",
  "badges",
  "billing",
  "buddy-score",
  "dashboard",
  "discover",
  "drops",
  "events",
  "friends",
  "groups",
  "hangout-mode",
  "help",
  "invite",
  "invites",
  "meeting-pings",
  "messages",
  "moments",
  "notifications",
  "onboarding",
  "plans",
  "profile",
  "reminders",
  "reset-password",
  "safe-arrival",
  "safety",
  "safety-center",
  "scan",
  "settings",
  "upgrade"
]);

export function safeAuthNext(value: string | null, fallback: string = POST_LOGIN_ROUTE) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://mad-buddy.internal");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return fallback;
    const sensitiveKeys = new Set(["access_token", "refresh_token", "code", "password", "service_role"]);
    if (
      [...destination.searchParams.keys()].some((key) => sensitiveKeys.has(key.toLowerCase())) ||
      /(?:access_token|refresh_token|password|service_role)=/i.test(destination.hash)
    ) {
      return fallback;
    }
    const root = destination.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!AUTH_DESTINATION_ROOTS.has(root)) return fallback;
    if (
      destination.pathname === "/login" ||
      destination.pathname === "/signup" ||
      destination.pathname === "/admin/login" ||
      destination.pathname.startsWith("/auth/")
    ) {
      return fallback;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

export function oauthErrorMessage(value?: string) {
  if (!value || !(value in AUTH_ERROR_MESSAGES)) {
    return null;
  }

  return AUTH_ERROR_MESSAGES[value as OAuthErrorCode];
}

export function authErrorRedirect(
  origin: string,
  path: "/login" | "/signup",
  code: OAuthErrorCode,
  next?: string
) {
  const url = new URL(path, origin);
  url.searchParams.set("oauth_error", code);
  if (next) url.searchParams.set("next", safeAuthNext(next));
  return url;
}
