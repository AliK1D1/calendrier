import { avatarHue, initials } from "@/lib/ux/avatar";
import { cn } from "@/lib/utils";

/** Pastille ronde avec les initiales d'une personne, d'une couleur qui lui est propre. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ "--teinte-avatar": avatarHue(name) } as React.CSSProperties}
      className={cn(
        "pastille-personne flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wide select-none",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
