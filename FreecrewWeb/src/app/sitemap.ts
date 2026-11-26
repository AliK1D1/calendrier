import type { MetadataRoute } from "next";

import { INDEXABLE_PATHS, siteUrl } from "@/lib/seo/site";

/** /sitemap.xml : les pages publiques, à soumettre dans Google Search Console. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl(process.env);
  return INDEXABLE_PATHS.map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
