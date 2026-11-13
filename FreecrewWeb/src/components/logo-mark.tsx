import { cn } from "@/lib/utils";

/**
 * Logo de l'app : deux cercles qui se croisent, la partie commune pleine (le temps libre que
 * deux horaires ont en commun). Même dessin que l'icône de l'app (public/icon.svg).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-[0.625rem]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[72%]" fill="none">
        <circle cx="9" cy="12" r="6" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="15" cy="12" r="6" stroke="currentColor" strokeWidth="1.75" />
        {/* Intersection des deux cercles. */}
        <path d="M12 6.8a6 6 0 0 1 0 10.4a6 6 0 0 1 0-10.4Z" fill="currentColor" />
      </svg>
    </span>
  );
}
