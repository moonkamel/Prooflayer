// sitemap.xml : pages publiques indexables (src/lib/site.ts).
import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((page) => ({
    url: new URL(page.path, base).toString(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
