// robots.txt : seul le site public de production est indexé ; les prévisualisations Vercel ne le sont jamais.
import type { MetadataRoute } from "next";
import { indexable, PRIVATE_PREFIXES, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  if (!indexable()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] }],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.origin,
  };
}
