import Link from "next/link";

/**
 * Sommaire « Sur cette page » : une rangée de liens vers les sections d'une longue page
 * (Groupe, Profil). Au téléphone, la rangée défile de côté au lieu de passer à la ligne.
 */
export function PageSections({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="Sur cette page" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-2 text-sm">
        {items.map((i) => (
          <li key={i.id}>
            <Link
              href={`#${i.id}`}
              className="bg-card hover:bg-accent flex h-9 items-center rounded-full border px-3 whitespace-nowrap"
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
