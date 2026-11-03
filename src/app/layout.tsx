import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

/** Couleur de la barre du navigateur sur téléphone, assortie au fond (clair ou sombre). */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1218" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr-CA">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
