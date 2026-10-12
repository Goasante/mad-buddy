import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { MA_BOOK } from "@/lib/books/product";
export default function sitemap(): MetadataRoute.Sitemap {return [{url:absoluteUrl(MA_BOOK.path),changeFrequency:"monthly",priority:1}];}
