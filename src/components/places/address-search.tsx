"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readGeocodeApiResponse } from "@/lib/geocoding/client";
import type { GeocodeResult } from "@/lib/geocoding/nominatim";
import { cn } from "@/lib/utils";

export interface AddressSearchProps {
  label: string;
  placeholder?: string;
  selectedId?: string | null;
  onSelect: (result: GeocodeResult) => void;
}

/**
 * Recherche d'adresse : on tape, on appuie sur « Chercher » (pas d'appel à chaque touche,
 * comme le demande Nominatim), puis on choisit un résultat.
 */
export function AddressSearch({ label, placeholder, selectedId, onSelect }: AddressSearchProps) {
  const id = useId();
  const [query, setQuery] = useState("");
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
      setError("Pas de connexion. Réessaie.");
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
            placeholder={placeholder ?? "Ex. Cégep Édouard-Montpetit"}
            autoComplete="off"
            enterKeyHint="search"
            minLength={3}
            maxLength={200}
            required
          />
          <Button type="submit" disabled={loading} aria-label="Chercher">
            <Search />
            <span className="hidden sm:inline">{loading ? "Recherche…" : "Chercher"}</span>
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {results && results.length === 0 && (
        <p className="text-muted-foreground text-sm" role="status">
          Aucun lieu trouvé. Essaie avec l&apos;adresse complète (numéro, rue, ville).
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Résultats">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                aria-pressed={selectedId === r.id}
                className={cn(
                  "hover:bg-accent w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
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
      <p className="text-muted-foreground text-xs">
        Recherche : © les contributeurs d&apos;OpenStreetMap (Nominatim).
      </p>
    </div>
  );
}
