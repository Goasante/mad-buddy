export const routes = {
  home: "/",
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  friends: "/friends",
  plans: "/plans",
  messages: "/messages",
  profile: "/profile",
  settings: "/settings",
  notifications: "/notifications",
  pricing: "/pricing",
  upgrade: "/upgrade",
  billing: "/billing",
  subscriptionSuccess: "/subscription-success",
  subscriptionCancelled: "/subscription-cancelled"
} as const;

/**
 * Where a signed-in Muddy lands.
 *
 * Muddies is the face of the app: people come back to see who is around, so
 * that is what they should meet. Declared once here because three different
 * places used to hardcode the destination independently — the auth `next`
 * fallback, the guest-only redirect, and the app shell.
 */
export const POST_LOGIN_ROUTE = routes.friends;
