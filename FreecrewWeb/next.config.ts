import type { NextConfig } from "next";

/**
 * En-têtes de sécurité envoyés avec chaque page. Ils ne changent rien à l'affichage :
 * - X-Frame-Options / frame-ancestors : l'app ne peut pas être affichée dans un iframe
 *   d'un autre site (protection contre le « clickjacking », ex. faux bouton « Accepter »).
 * - X-Content-Type-Options : le navigateur ne devine pas le type d'un fichier.
 * - Referrer-Policy : les liens d'invitation (/groupes/[id]) ne fuient pas vers d'autres sites.
 * - Permissions-Policy : pas de caméra ni de micro ; la géolocalisation seulement pour l'app.
 * - Strict-Transport-Security : HTTPS obligatoire une fois déployé.
 * Une Content-Security-Policy complète viendra au segment 17 (déploiement), quand les
 * domaines Supabase et de l'API de trajets seront connus.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Ne pas annoncer « X-Powered-By: Next.js » (aide un attaquant à cibler les failles connues).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
