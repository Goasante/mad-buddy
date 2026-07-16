import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/billing/",
        "/dashboard/",
        "/friends/",
        "/login",
        "/notifications/",
        "/onboarding/",
        "/profile/",
        "/reset-password",
        "/settings/",
        "/signup",
        "/subscription-cancelled",
        "/subscription-success",
        "/upgrade/"
      ]
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/")
  };
}
