import Link from "next/link";

const LIENS = [
  { href: "/lieux", label: "Mes lieux" },
  { href: "/profil", label: "Profil" },
];

/** En-tête des pages connectées : retour à l'accueil et liens principaux. */
export function SiteHeader() {
  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      <nav
        aria-label="Navigation principale"
        className="mx-auto flex h-12 max-w-3xl items-center gap-4 px-4 text-sm"
      >
        <Link href="/" className="font-semibold">
          Temps libre commun
        </Link>
        <span className="flex-1" />
        {LIENS.map((l) => (
          <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
