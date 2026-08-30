import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

const lastModified = new Date("2026-08-30T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), lastModified, changeFrequency: "monthly", priority: 1 },
    { url: absoluteUrl("/about"), lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/safety"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/faq"), lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/support"), lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/pricing"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/privacy"), lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/terms"), lastModified, changeFrequency: "yearly", priority: 0.4 }
  ];
}
