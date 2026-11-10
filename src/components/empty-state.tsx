import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Encadré d'une liste vide : une icône, ce qui manque, et quoi faire ensuite (lien ou bouton
 * dans `children`).
 */
export function EmptyState({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground bg-muted/50 flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-card text-primary flex size-10 shrink-0 items-center justify-center rounded-full border"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
