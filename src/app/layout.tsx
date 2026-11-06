import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

/** Couleur de la barre du navigateur sur téléphone, assortie au fond (clair ou sombre). */
export const viewport: Viewport = {
  // Le contenu va jusqu'aux bords (encoche, geste d'accueil) ; les marges sûres sont gérées
  // avec `env(safe-area-inset-*)` dans l'en-tête, la barre d'onglets et les messages.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1218" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getI18n();
  return (
    <html lang={HTML_LANG[locale]}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
