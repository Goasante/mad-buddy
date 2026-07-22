const fallbackSiteUrl = "http://localhost:3000";

/**
 * The app's public base URL. Prefers NEXT_PUBLIC_APP_URL, but when that is unset
 * or empty (which is what silently produced password-reset emails, Paystack
 * return URLs, and OG/canonical links pointing at http://localhost:3000) it
 * falls back to Vercel's automatically-provided production domain before
 * localhost. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL are server-only, so
 * client renders still rely on NEXT_PUBLIC_APP_URL.
 */
export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const candidate =
    configuredUrl ||
    (vercelProductionUrl ? `https://${vercelProductionUrl}` : "") ||
    (vercelUrl ? `https://${vercelUrl}` : "") ||
    fallbackSiteUrl;

  try {
    return new URL(candidate);
  } catch {
    return new URL(fallbackSiteUrl);
  }
}

export function absoluteUrl(path = "/") {
  return new URL(path, getSiteUrl()).toString();
}
