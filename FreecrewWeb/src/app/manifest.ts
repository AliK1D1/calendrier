import type { MetadataRoute } from "next";

/**
 * Manifeste de l'app installable (PWA) : servi à /manifest.webmanifest, lié automatiquement
 * par Next.js dans chaque page. Le fichier est public (pas de session) : voir le `matcher` de
 * src/middleware.ts. Icônes produites par scripts/generate-icons.mjs.
 *
 * Pas de service worker : l'app a besoin du réseau (horaires, groupes) et ne met rien en
 * cache hors ligne ; les navigateurs récents l'installent quand même.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Freecrew",
    short_name: "Freecrew",
    description: "Trouvez des moments et des endroits réalistes pour vous voir entre amis.",
    lang: "fr-CA",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8f9fb",
    theme_color: "#2c5fa9",
    categories: ["social", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
