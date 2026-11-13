"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

import {
  ACCENTS,
  ACCENT_PAR_DEFAUT,
  CLE_ACCENT,
  CLE_THEME,
  EVENEMENT_APPARENCE,
  THEME_LIBELLES,
  THEME_PAR_DEFAUT,
  THEMES,
  type AccentId,
  type ChoixTheme,
  lireAccent,
  lireTheme,
} from "@/lib/ux/apparence";
import { cn } from "@/lib/utils";

const ICONES: Record<ChoixTheme, typeof Sun> = { systeme: Monitor, clair: Sun, sombre: Moon };

function lire(cle: string): string | null {
  try {
    return window.localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrire(cle: string, valeur: string) {
  try {
    window.localStorage.setItem(cle, valeur);
  } catch {
    // Navigation privée stricte : le choix vaut pour cette page seulement.
  }
  window.dispatchEvent(new Event(EVENEMENT_APPARENCE));
}

function abonner(rappel: () => void) {
  window.addEventListener(EVENEMENT_APPARENCE, rappel);
  window.addEventListener("storage", rappel);
  return () => {
    window.removeEventListener(EVENEMENT_APPARENCE, rappel);
    window.removeEventListener("storage", rappel);
  };
}

/** Le choix vit dans le navigateur ; côté serveur on affiche les valeurs par défaut. */
function useChoix<T extends string>(cle: string, lecture: (v: unknown) => T, defaut: T): T {
  return useSyncExternalStore(
    abonner,
    () => lecture(lire(cle)),
    () => defaut,
  );
}

const PASTILLE =
  "focus-visible:ring-ring/50 flex items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] h-11 sm:h-9";

/**
 * Profil > Apparence : thème (selon l'appareil, clair, sombre) et couleur d'accent.
 * S'applique tout de suite et reste enregistré sur cet appareil (pas de bouton Enregistrer).
 */
export function AppearanceForm() {
  const theme = useChoix(CLE_THEME, lireTheme, THEME_PAR_DEFAUT);
  const accent = useChoix(CLE_ACCENT, lireAccent, ACCENT_PAR_DEFAUT);

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Thème</legend>
        <div className="grille-4-demi sm:flex sm:flex-wrap sm:gap-2">
          {THEMES.map((t) => {
            const Icone = ICONES[t];
            const actif = theme === t;
            return (
              <label
                key={t}
                className={cn(
                  PASTILLE,
                  "has-[:focus-visible]:ring-ring/50 cursor-pointer has-[:focus-visible]:ring-[3px]",
                  actif
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent hover:text-accent-foreground",
                  t === "systeme" && "col-span-4",
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={actif}
                  onChange={() => ecrire(CLE_THEME, t)}
                  className="sr-only"
                />
                <Icone className="size-4" aria-hidden />
                {THEME_LIBELLES[t]}
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          « Selon l&apos;appareil » passe en sombre en même temps que ton téléphone ou ton
          ordinateur.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Couleur d&apos;accent</legend>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const actif = accent === a.id;
            return (
              <label
                key={a.id}
                className={cn(
                  PASTILLE,
                  "has-[:focus-visible]:ring-ring/50 cursor-pointer pl-2 has-[:focus-visible]:ring-[3px]",
                  actif
                    ? "border-foreground/40 bg-secondary text-secondary-foreground"
                    : "bg-card hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <input
                  type="radio"
                  name="accent"
                  value={a.id}
                  checked={actif}
                  onChange={() => ecrire(CLE_ACCENT, a.id satisfies AccentId)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className="pastille-accent text-primary-foreground flex size-5 items-center justify-center rounded-full"
                  style={{ "--teinte": a.teinte, "--chroma": a.chroma } as CSSProperties}
                >
                  {actif && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                {a.libelle}
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          Pour les boutons, les liens actifs et le contour de sélection. Les couleurs des jours et
          des blocs de l&apos;horaire ne changent pas.
        </p>
      </fieldset>

      <p className="text-muted-foreground text-xs">
        Enregistré sur cet appareil seulement : ton téléphone et ton ordinateur peuvent avoir des
        réglages différents.
      </p>
    </div>
  );
}
