"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readGeocodeApiResponse } from "@/lib/geocoding/client";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export interface AddressSearchProps {
  label: string;
  placeholder?: string;
  selectedId?: string | null;
  /** Texte de départ de la recherche (ex. le lieu lu dans un fichier .ics). */
  initialQuery?: string;
  onSelect: (result: GeocodeResult) => void;
}

/**
 * Recherche d'adresse : on tape, on appuie sur « Chercher » (pas d'appel à chaque touche,
 * comme le demande Nominatim), puis on choisit un résultat.
 */
export function AddressSearch({
  label,
  placeholder,
  selectedId,
  initialQuery,
  onSelect,
}: AddressSearchProps) {
  const id = useId();
  const { t, tr } = useI18n();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?${new URLSearchParams({ q: query })}`);
      const json: unknown = await res.json().catch(() => null);
      const r = readGeocodeApiResponse(res.status, json);
      if (r.ok) {
        setResults(r.results);
        if (r.results.length > 0) onSelect(r.results[0]);
      } else {
        setResults(null);
        setError(r.error);
      }
    } catch {
      setError(t.places.search.noConnection);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Formulaire à part : ne pas placer ce composant dans un autre <form>. */}
      <form onSubmit={search} className="flex flex-col gap-2" role="search">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder ?? t.places.search.placeholder}
            autoComplete="off"
            enterKeyHint="search"
            minLength={3}
            maxLength={200}
            required
          />
          <Button type="submit" disabled={loading} aria-label={t.places.search.button}>
            <Search />
            <span className="hidden sm:inline">
              {loading ? t.places.search.searching : t.places.search.button}
            </span>
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tr(error)}
        </p>
      )}

      {results && results.length === 0 && (
        <p className="text-muted-foreground text-sm" role="status">
          {t.places.search.noResult}
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t.places.search.results}>
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                aria-pressed={selectedId === r.id}
                className={cn(
                  "bg-card hover:bg-accent w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  selectedId === r.id && "border-primary bg-accent",
                )}
              >
                <span className="font-medium">{r.name}</span>
                {r.kind && <span className="text-muted-foreground"> · {r.kind}</span>}
                <span className="text-muted-foreground block truncate text-xs">{r.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{t.places.search.credit}</p>
    </div>
  );
}
