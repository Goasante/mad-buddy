import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// Note: robots.txt is a crawl hint, not access control. Every route listed
// here is also auth-gated by the deny-by-default guard in proxy.ts, this
// list only keeps login-redirect noise out of search results.
// No trailing slashes: Next.js serves these paths without them, and
// robots.txt matching is a literal prefix match.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/badges",
        "/billing",
        "/buddy-score",
        "/dashboard",
        "/discover",
        "/drops",
        "/events",
        "/forgot-password",
        "/friends",
        "/groups",
        "/hangout-mode",
        "/help",
        "/invite",
        "/invites",
        "/login",
        "/meeting-pings",
        "/messages",
        "/moments",
        "/notifications",
        "/onboarding",
        "/plans",
        "/profile",
        "/reminders",
        "/reset-password",
        "/safe-arrival",
        "/safety",
        "/safety-center",
        "/scan",
        "/settings",
        "/signup",
        "/subscription-cancelled",
        "/subscription-success",
        "/upgrade"
      ]
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/")
  };
}
