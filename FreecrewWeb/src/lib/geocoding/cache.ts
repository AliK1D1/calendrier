/**
 * Petit cache en mémoire avec durée de vie et taille bornée (le plus ancien sort en premier,
 * une lecture remet l'entrée en tête). Horloge injectée pour les tests.
 */

export interface TtlCacheOptions {
  /** Nombre maximal d'entrées. */
  maxEntries: number;
  /** Durée de vie d'une entrée (ms). */
  ttlMs: number;
  /** Horloge (ms). Défaut : `Date.now`. */
  now?: () => number;
}

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
}

export function createTtlCache<V>(options: TtlCacheOptions): TtlCache<V> {
  const { maxEntries, ttlMs } = options;
  const now = options.now ?? Date.now;
  // Map garde l'ordre d'insertion : la première clé est la moins récemment utilisée.
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= now()) return undefined;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (maxEntries <= 0) return;
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}
