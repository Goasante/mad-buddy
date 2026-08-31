import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// robots.txt is a crawl hint, not access control. Authenticated routes remain
// protected by the application's route guards; this list keeps private and
// transitional surfaces out of search results.
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
