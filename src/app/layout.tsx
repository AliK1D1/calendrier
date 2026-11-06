import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { COULEUR_BARRE, SCRIPT_APPARENCE } from "@/lib/ux/apparence";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Temps libre commun",
  description: "Trouvez des moments et des endroits réalistes pour vous voir entre amis.",
  applicationName: "Temps libre commun",
  // Écran d'accueil du téléphone (le manifeste vient de src/app/manifest.ts).
  appleWebApp: { capable: true, title: "Temps libre", statusBarStyle: "default" },
  // favicon.ico est ajouté automatiquement par Next.js (src/app/favicon.ico).
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

/**
 * Couleur de la barre du navigateur sur téléphone, assortie au fond (clair ou sombre). Si la
 * personne force un thème (Profil > Apparence), le script du <head> remplace ces couleurs.
 */
export const viewport: Viewport = {
  // Le contenu va jusqu'aux bords (encoche, geste d'accueil) ; les marges sûres sont gérées
  // avec `env(safe-area-inset-*)` dans l'en-tête, la barre d'onglets et les messages.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: COULEUR_BARRE.clair },
    { media: "(prefers-color-scheme: dark)", color: COULEUR_BARRE.sombre },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Le script d'apparence ajoute data-theme et data-accent à <html> avant React : React ne
    // doit pas s'en plaindre à l'hydratation (seulement sur cette balise).
    <html lang="fr-CA" suppressHydrationWarning>
      <head>
        {/* Texte fixe écrit par nous (aucune donnée de l'utilisateur) : sans risque d'injection. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_APPARENCE }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
