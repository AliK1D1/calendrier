import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { COULEUR_BARRE, SCRIPT_APPARENCE } from "@/lib/ux/apparence";

import "./globals.css";

// Texte : Instrument Sans, un peu étroite, pour que les titres de cours tiennent dans la grille
// de l'horaire. Titres : Bricolage Grotesque, plus de caractère.
const texte = Instrument_Sans({
  variable: "--font-texte",
  subsets: ["latin"],
  display: "swap",
});

const titres = Bricolage_Grotesque({
  variable: "--font-titres",
  subsets: ["latin"],
  display: "swap",
});

/** Titre et description dans la langue choisie. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.common.appName,
    description: t.common.appDescription,
    applicationName: t.common.appName,
    // Écran d'accueil du téléphone (le manifeste vient de src/app/manifest.ts).
    appleWebApp: { capable: true, title: t.common.appShortName, statusBarStyle: "default" },
    // favicon.ico est ajouté automatiquement par Next.js (src/app/favicon.ico).
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getI18n();
  return (
    // Le script d'apparence ajoute data-theme et data-accent à <html> avant React : React ne
    // doit pas s'en plaindre à l'hydratation (seulement sur cette balise).
    <html lang={HTML_LANG[locale]} suppressHydrationWarning>
      <head>
        {/* Texte fixe écrit par nous (aucune donnée de l'utilisateur) : sans risque d'injection. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_APPARENCE }} />
      </head>
      <body className={`${texte.variable} ${titres.variable} antialiased`}>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
