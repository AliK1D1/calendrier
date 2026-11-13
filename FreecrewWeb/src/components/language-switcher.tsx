"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocaleAction } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Bouton de langue de l'en-tête : passe à l'autre langue (FR ↔ EN). Le choix est gardé dans
 * un cookie, puis la page est redessinée dans la nouvelle langue.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = LOCALES.find((l) => l !== locale) ?? locale;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocaleAction(next);
          router.refresh();
        })
      }
      lang={next}
      aria-label={t.common.language.switchTo(LOCALE_NAMES[next])}
      title={t.common.language.switchTo(LOCALE_NAMES[next])}
      className={cn(
        "text-muted-foreground hover:text-foreground sm:hover:bg-accent/60 flex h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1 text-xs font-semibold uppercase transition-colors disabled:opacity-60 sm:h-8 sm:px-2",
        className,
      )}
    >
      <Languages className="size-4" aria-hidden />
      {next}
    </button>
  );
}
