import { CalendarHeart } from "lucide-react";

import { cn } from "@/lib/utils";

/** Petit logo de l'app : un calendrier dans un carré bleu, utilisé dans l'en-tête et l'accueil. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <CalendarHeart className="size-4" />
    </span>
  );
}
