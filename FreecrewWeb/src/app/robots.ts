import type { MetadataRoute } from "next";

import { PRIVATE_PATHS, isIndexable, siteUrl } from "@/lib/seo/site";

/**
 * /robots.txt : Google peut visiter l'accueil et les pages de connexion, pas les pages
 * privées. Sur un aperçu Vercel, tout est interdit (seul le site de production est indexé).
 * Le fichier est public : le `matcher` de src/middleware.ts exclut les .txt.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl(process.env);
  if (!isIndexable(process.env)) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
